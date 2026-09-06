import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import CoreVideo

/// Accumulates CVPixelBuffer frames and writes them as an animated GIF.
/// Each frame's pixel data is copied immediately so the pixel buffer can be
/// safely recycled (alwaysCopiesSampleData=false).
final class GIFEncoder {

    private let url: URL
    private var destination: CGImageDestination?
    private let gifProperties: [CFString: Any]
    private var frameCount = 0
    private let lock = NSLock()

    // Throttle: only keep every Nth frame to stay at target fps
    private let targetFPS: Int
    private var inputFrameCount = 0
    private let sourceEstimatedFPS: Int

    init(url: URL, fps: Int, sourceFPS: Int) {
        self.url = url
        self.sourceEstimatedFPS = max(sourceFPS, fps)
        // Cap GIF at 30fps for reasonable file size
        let gifFPS = min(fps, 30)
        self.targetFPS = gifFPS
        gifProperties = [
            kCGImagePropertyGIFDictionary: [
                kCGImagePropertyGIFLoopCount: 0,
            ] as [CFString: Any]
        ]

        destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, Int.max, nil)
        if let dest = destination {
            CGImageDestinationSetProperties(dest, gifProperties as CFDictionary)
        }
    }

    /// Add a frame. Called from background thread — thread safe via lock.
    func addFrame(_ pixelBuffer: CVPixelBuffer) {
        lock.lock()
        defer { lock.unlock() }

        // Fractional decimation: keep a frame whenever the target timeline
        // advances. Exact for any source/target fps pair (e.g. 24 -> 15), not
        // only when target divides source evenly — mirrors GifskiExporter.
        inputFrameCount += 1
        let prevTargetIndex = (inputFrameCount - 1) * targetFPS / sourceEstimatedFPS
        let targetIndex = inputFrameCount * targetFPS / sourceEstimatedFPS
        guard targetIndex > prevTargetIndex else { return }

        guard let dest = destination else { return }

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
            return
        }

        // Copy pixel rows straight into an owned context (single memcpy per row)
        // instead of wrapping the buffer in a CGContext and blend-drawing it —
        // the draw path did an extra full-frame copy plus format conversion per
        // frame. Source is 32BGRA which matches the context's bitmapInfo, so a
        // raw byte copy is safe. The owned copy itself is still required:
        // CGImageDestinationFinalize reads all frames after the pixel buffer
        // has been recycled (alwaysCopiesSampleData=false).
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        let bitmapInfo = CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard let ownedCtx = CGContext(
            data: nil,
            width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4,
            space: colorSpace, bitmapInfo: bitmapInfo
        ), let dstAddress = ownedCtx.data else {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
            return
        }
        let dstBytesPerRow = ownedCtx.bytesPerRow
        let copyBytes = min(width * 4, min(bytesPerRow, dstBytesPerRow))
        for row in 0..<height {
            memcpy(dstAddress + row * dstBytesPerRow,
                   baseAddress + row * bytesPerRow,
                   copyBytes)
        }
        CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)

        guard let cgImage = ownedCtx.makeImage() else { return }
        CGImageDestinationAddImage(dest, cgImage, frameProperties(for: frameCount) as CFDictionary)
        frameCount += 1
    }

    /// GIF delays are stored in hundredths of a second. A fixed `1 / fps`
    /// delay is rounded independently for every frame (for example, 1/15 to
    /// 0.07), making a 15 fps GIF 5% too slow. Round cumulative presentation
    /// times instead so the 0.06/0.07 pattern averages to the requested rate.
    private func frameProperties(for outputFrameIndex: Int) -> [CFString: Any] {
        let previousTick = Int((Double(outputFrameIndex) * 100.0 / Double(targetFPS)).rounded())
        let nextTick = Int((Double(outputFrameIndex + 1) * 100.0 / Double(targetFPS)).rounded())
        let delayTime = Float(max(1, nextTick - previousTick)) / 100.0
        return [
            kCGImagePropertyGIFDictionary: [
                kCGImagePropertyGIFDelayTime: delayTime,
                kCGImagePropertyGIFLoopCount: 0,  // 0 = infinite
            ] as [CFString: Any]
        ]
    }

    func finish() {
        guard let dest = destination, frameCount > 0 else { return }
        CGImageDestinationFinalize(dest)
        destination = nil
    }
}
