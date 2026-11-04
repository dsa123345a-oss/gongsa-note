; Compile a previously verified onedir release with Inno Setup 6.5 or newer:
; ISCC /DAppVersion=0.13.37 /DAppSource=C:\release\gongsa-note /DOutputDir=C:\release\assets gongsa-note-installer.iss
; AppSource must be the clean folder validated by tools/prepare_release.py.
; Include this installer beside the ZIP/update.json; the in-app updater still uses the ZIP.
; Never add a wildcard for {app} to [InstallDelete] or [UninstallDelete]:
; user projects, settings, backups, and databases live next to the executable.

#ifndef AppVersion
  #error AppVersion is required (for example /DAppVersion=0.13.37)
#endif
#ifndef AppSource
  #error AppSource is required (the validated onedir application folder)
#endif
#ifndef OutputDir
  #error OutputDir is required (the release asset directory)
#endif

#define AppExe "공사노트.exe"
#define AppRuntime "_internal_" + StringChange(AppVersion, ".", "_")
#define AppIcon AppSource + "\" + AppRuntime + "\dist\app-icon.ico"

#if !FileExists(AppSource + "\" + AppExe)
  #error The application executable does not exist in AppSource.
#endif
#if !FileExists(AppSource + "\" + AppRuntime + "\release.json")
  #error The requested version-specific runtime is missing.
#endif

[Setup]
AppId={{AD873B1B-BA85-4B0C-8E11-C235547F8D67}
AppName=공사노트
AppVersion={#AppVersion}
AppVerName=공사노트 {#AppVersion}
AppPublisher=공사노트
AppPublisherURL=https://github.com/dsa123345a-oss/gongsa-note
AppSupportURL=https://github.com/dsa123345a-oss/gongsa-note/issues
AppUpdatesURL=https://github.com/dsa123345a-oss/gongsa-note/releases/latest
DefaultDirName={localappdata}\GongsaNote
DefaultGroupName=공사노트
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
AppMutex=Local\GongsaNoteDesktopV1
SetupMutex=Local\GongsaNoteInstallerV1
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no
OutputDir={#OutputDir}
OutputBaseFilename=gongsa-note-setup
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 공사노트 바로 가기 만들기"; GroupDescription: "바로 가기"

[Files]
; Only application files enter the installation/uninstallation log.
; Existing "공사노트 자료" and saved project files are never packaged or deleted.
Source: "{#AppSource}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#AppSource}\{#AppRuntime}\*"; DestDir: "{app}\{#AppRuntime}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\공사노트"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\공사노트"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Description: "공사노트 실행"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { AppMutex checks startup; check again if the app opened while the wizard was shown. }
  Result := '';
  if CheckForMutexes('Local\GongsaNoteDesktopV1') then
    Result := '공사노트가 실행 중입니다. 작업을 저장하고 공사노트를 닫은 뒤 설치를 다시 진행하세요.';
end;
