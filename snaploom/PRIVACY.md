# Privacy Policy

Last updated: August 26, 2026

## Overview

Snaploom is a local-first screenshot and screen-recording tool for macOS. The project does not operate an application backend and does not include telemetry, analytics, advertising, or crash-reporting services.

## Data Stored on Your Mac

Snaploom stores preferences, capture history, temporary export data, and optional service credentials inside its macOS sandbox container:

`~/Library/Containers/io.github.xiaoouwaou.snaploom/Data/`

Screenshots and recordings are saved only to locations you select. Capture history can be limited or disabled in Settings.

## Optional Network Requests

Snaploom accesses the network only for features you choose to use:

- **Updates:** checks the public Snaploom appcast hosted in this GitHub repository.
- **Apple or Google translation:** sends recognized text only when the selected translation provider requires a network request. Apple on-device translation can work offline when its language packs are installed.
- **imgbb:** uploads a selected image using the API key you provide.
- **Google Drive:** uploads selected files to your Drive when a maintainer-configured OAuth client is present and you sign in.
- **S3-compatible storage:** uploads selected files to the endpoint and bucket you configure.

Third-party services process data under their own terms and privacy policies. Snaploom cannot access files outside the permissions and locations granted by macOS.

## Permissions

- Screen Recording: required for screenshots and recordings.
- Accessibility: optional; used for automated scrolling and some recording overlays.
- Input Monitoring: optional; used to show keystrokes during recording.
- Microphone: optional; used for voice recording.
- Camera: optional; used for the webcam overlay.

Permissions can be revoked at any time in System Settings > Privacy & Security.

## Contact

Open a private security report or issue at https://github.com/xiaoou-waou/Snaploom.
