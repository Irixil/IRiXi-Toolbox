# Contributing to Snaploom

Thanks for helping improve Snaploom.

## Development Setup

1. Open `Snaploom.xcodeproj` in Xcode.
2. Select the `Snaploom` scheme.
3. Build and run.
4. Grant Screen Recording permission when prompted.

The project uses Xcode synchronized file groups, so new Swift files placed in `SnaploomApp/` are discovered automatically.

## Guidelines

- Prefer AppKit and Apple frameworks over new dependencies.
- Keep the minimum deployment target at macOS 12.3 unless a change is explicitly discussed.
- Guard newer APIs with availability checks.
- Preserve the scoped undo handling described in `AGENTS.md` for editable text views.
- Test coordinate and capture changes on single- and multi-display setups.
- Keep pull requests focused and explain both the behavior and the reason for the change.

## Verification

Before opening a pull request:

- Build the Debug configuration without code signing.
- Exercise the changed workflow manually.
- Check that no credentials, local paths, or personal signing identifiers are committed.
