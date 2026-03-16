# DroidLink

**Open-source Android phone manager for desktop. USB-first, privacy-first.**

DroidLink is a cross-platform desktop application that manages Android devices over USB via ADB. No cloud accounts, no network required — your data stays between your phone and your computer.

> **DroidLink is the only open-source tool that supports syncing call logs from Android to PC via USB ADB.**
> Contacts, SMS messages, and call logs are read directly from Android's content providers through a companion app, then stored locally in SQLite. No third-party services, no root required.

## Features

### Data Sync (USB ADB)

- **Contacts** — Read all contacts from Android and sync to local database
- **SMS Messages** — Read all text messages (inbox, sent, drafts) and sync locally
- **Call Logs** — Sync complete call history (incoming, outgoing, missed, rejected) with duration, date, and phone number. **This is a unique capability not found in other open-source Android management tools.**
- **Clipboard Sync** — Bidirectional clipboard sharing between phone and PC

### File Management

- **File Browser** — Browse Android filesystem with breadcrumb navigation, search, and sorting
- **Upload/Download** — Transfer files and folders between PC and Android
- **Drag-and-Drop** — Drag files from your system file manager into DroidLink to upload, or drag files from DroidLink out to your desktop (Linux/GNOME supported)
- **Copy/Move** — Copy or move files within Android, or transfer to local PC with a tabbed dialog
- **Multi-Select** — Checkbox selection for batch operations (delete, download, copy, move)
- **Context Menu** — Right-click for rename, delete, copy, move, download, and other operations
- **Keyboard Shortcuts** — Delete, F2 (rename), Ctrl+A (select all), Backspace (go up)
- **New Folder / Rename / Delete** — Full CRUD operations on the Android filesystem

### Folder Sync

- **Syncthing-inspired** bidirectional folder synchronization
- **Conflict policies** — Keep both, local wins, remote wins, or newest wins
- **Ignore patterns** — `.droidlinkignore` file with glob wildcards (like `.gitignore`)
- **Version history** — Automatic `.stversions/` backup with configurable retention
- **Integrity verification** — xxHash (xxh3) for change detection, MD5 for transfer verification
- **Resumable transfers** — Transfer journal with temp files + atomic rename; interrupted transfers resume on reconnect
- **Real-time monitoring** — Optional file watcher via `notify` crate for instant sync
- **USB speed detection** — Displays estimated transfer speed (USB 2.0/3.0) and FAT32 4GB limit warnings

### Screen Mirroring

- **Real-time screen mirror** via bundled scrcpy (built from source on Linux/macOS)
- **Advanced settings panel** with all scrcpy options:
  - Recording to file (MP4/MKV)
  - Custom window title, crop region, display ID, rotation
  - Input modes: prefer-text, mouse binding, OTG
  - Audio/video toggles, stay-awake
- **Auto-detect window close** — Button state resets when scrcpy window is closed
- **Multiple scrcpy sources** — Use bundled, system PATH, or custom executable

### Multi-Device Support

- **Simultaneous connections** — Connect multiple Android devices via USB
- **Device selector** — Dropdown in sidebar to switch active device
- **Per-device state** — Each device has independent companion status, sync progress, and data
- **Auto-select** — First device auto-selected; if active device disconnects, next one is selected

### Companion App

- **DroidLink Companion** — Lightweight Android app (auto-installed on first connect)
- **Content provider access** — Reads contacts, SMS, call logs via Android APIs (not raw database)
- **Custom IME** — DroidLink Input Method for full Unicode text injection (CJK, emoji) into scrcpy
- **Minimal permissions** — Only requests what's needed (contacts, SMS, call logs, accessibility)

### Settings & Customization

- **7 languages** — English, Chinese (zh), Japanese (ja), Korean (ko), Russian (ru), German (de), Arabic (ar)
- **ADB/scrcpy path** — Choose bundled, system, or custom executable paths
- **Display density** — Compact or comfortable UI mode
- **Custom fonts** — Pick any system font for the interface
- **Data storage path** — Choose where local database and synced data are stored, with migration support
- **Safety controls** — Block push-to-device mode (pull-only for safety)
- **Logging** — Log file with auto-rotation (10MB), viewable path in settings

## System Requirements

| Component | Requirement |
|---|---|
| **OS** | Windows 10+, macOS 12+, Linux (Debian/Ubuntu 22.04+, Fedora, AppImage) |
| **Android** | Android 5.0+ (API 21+) for basic features; Android 12+ for camera mirroring |
| **Connection** | USB cable with ADB debugging enabled |
| **Disk** | ~150MB for application + space for synced data |

## Getting Started

### 1. Enable USB Debugging on Android

1. Go to **Settings > About Phone**
2. Tap **Build Number** 7 times to enable Developer Options
3. Go to **Settings > Developer Options**
4. Enable **USB Debugging**

### 2. Install DroidLink

Download the latest release for your platform from the [Releases](https://github.com/ai2master/DroidLink/releases) page:

- **Windows**: `.msi` (installer) or `.exe` (NSIS installer)
- **macOS**: `.dmg`
- **Linux**: `.deb`, `.rpm`, or `.AppImage`

### 3. Connect Your Phone

1. Connect your Android phone to your computer via USB
2. Launch DroidLink
3. Accept the USB debugging prompt on your phone
4. DroidLink will auto-detect your device and show it in the sidebar

### 4. Install Companion App

On first connection, DroidLink will prompt you to install the companion app on your phone. This is required for contacts, SMS, and call log sync. The companion app is built from source during CI and is bundled with DroidLink.

## Building from Source

### Prerequisites

- **Node.js** 20+
- **Rust** stable toolchain
- **Java** 17+ (for building companion Android app)
- **Gradle** 8.5+
- Platform-specific dependencies (see below)

### Linux (Debian/Ubuntu)

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev librsvg2-dev patchelf \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev

# For building scrcpy from source:
sudo apt-get install -y \
  ffmpeg libsdl2-dev libavcodec-dev libavdevice-dev \
  libavformat-dev libavutil-dev libswresample-dev \
  libusb-1.0-0-dev meson ninja-build pkg-config
```

### macOS

```bash
brew install ffmpeg sdl2 meson pkg-config libusb
```

### Build Steps

```bash
# Clone repository
git clone https://github.com/ai2master/DroidLink.git
cd DroidLink

# Install npm dependencies
npm install

# Build companion Android app
cd android
gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../src-tauri/resources/companion/DroidLinkCompanion.apk
cd ..

# Place ADB and scrcpy binaries in resources/
# (See .github/workflows/build.yml for platform-specific steps)

# Build and run in development mode
npx tauri dev

# Build release
npx tauri build
```

## Architecture

```
DroidLink
├── src/                    # React TypeScript frontend
│   ├── pages/              # Dashboard, Contacts, Messages, CallLogs,
│   │                       # FileManager, FolderSync, ScreenMirror,
│   │                       # Transfer, VersionHistory, Settings
│   ├── components/         # Sidebar, StatusBar, UI primitives (shadcn/ui)
│   ├── stores/             # Zustand state management
│   └── i18n/               # 7 locale files
├── src-tauri/              # Rust backend (Tauri v2)
│   └── src/
│       ├── adb/            # ADB command wrappers, device monitor
│       ├── commands/       # Tauri IPC command handlers
│       ├── db/             # SQLite database (contacts, messages, call logs, sync state)
│       ├── scrcpy/         # scrcpy process management, IME integration
│       ├── transfer/       # Folder sync engine, transfer journal
│       └── lib.rs          # App initialization, logging, event system
└── android/                # Companion Android app (Kotlin)
    └── app/src/main/
        ├── ContentProviderReader.kt  # Read contacts/SMS/call logs
        ├── DroidLinkIME.kt           # Custom input method
        └── CompanionService.kt       # Background accessibility service
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Tailwind CSS 4, Radix UI, Zustand, react-i18next |
| **Backend** | Rust, Tauri v2, tokio, rusqlite, serde |
| **Android** | Kotlin, Android SDK 34, Gradle |
| **Screen Mirror** | scrcpy 3.1 (built from source on Linux/macOS, pre-built on Windows) |
| **ADB** | Google platform-tools (bundled) |
| **Build** | Vite, Cargo, GitHub Actions (3-platform CI) |

### Data Flow

```
Android Device
  ↕ USB Cable
ADB Server (localhost:5037)
  ↕ ADB Protocol
Rust Backend (Tauri)
  ├── adb::shell()        → Execute commands on device
  ├── adb::push()/pull()  → File transfer
  ├── db::*               → SQLite storage
  └── scrcpy::start()     → Screen mirror subprocess
  ↕ Tauri IPC (invoke/events)
React Frontend
  ├── Pages               → UI for each feature
  ├── Zustand Store       → Multi-device state
  └── i18n                → Localization
```

### Security

- **No network connections** — All communication via USB ADB (localhost:5037 only)
- **Path sanitization** — Shell metacharacters rejected in all ADB commands
- **CSP enforced** — Content Security Policy restricts frontend resources
- **No telemetry** — No data sent anywhere, no analytics, no crash reporting

## License

This project is licensed under the [MIT License](LICENSE).

### Third-Party Licenses

| Component | License | Notes |
|---|---|---|
| [Tauri](https://tauri.app/) | MIT OR Apache-2.0 | Desktop framework |
| [scrcpy](https://github.com/Genymobile/scrcpy) | Apache-2.0 | Screen mirroring (bundled binary) |
| [ADB (platform-tools)](https://developer.android.com/tools/releases/platform-tools) | Apache-2.0 | Android Debug Bridge (bundled binary) |
| [React](https://react.dev/) | MIT | UI framework |
| [Radix UI](https://www.radix-ui.com/) | MIT | UI primitives |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | CSS framework |
| [lightningcss](https://lightningcss.dev/) | MPL-2.0 | CSS compiler (used as-is, not modified) |
| [SQLite](https://sqlite.org/) | Public Domain | Embedded database |
| [Zustand](https://zustand.docs.pmnd.rs/) | MIT | State management |

All Rust dependencies use MIT, Apache-2.0, BSL-1.0, CC0, or Unlicense — no copyleft licenses.

## Contributing

Contributions are welcome. Please open an issue first to discuss proposed changes.

## Acknowledgements

- [scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile — screen mirroring
- [Tauri](https://tauri.app/) — desktop application framework
- [shadcn/ui](https://ui.shadcn.com/) — UI component design system
