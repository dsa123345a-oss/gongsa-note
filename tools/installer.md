# Windows 설치 프로그램

사용자는 `gongsa-note-setup.exe`를 내려받아 설치합니다. 설치 프로그램은 현재 사용자 계정의 `%LOCALAPPDATA%\GongsaNote`에 실행파일과 해당 버전의 런타임을 설치합니다. 관리자 권한을 요구하지 않으며 바탕화면 바로 가기는 선택할 수 있습니다.

처음 설치할 때 GitHub의 ZIP을 탐색기에서 직접 풀면 인터넷 출처 표시가 DLL에 붙어 .NET 로딩이 실패할 수 있습니다. 설치 프로그램으로 런타임을 설치하며 Windows 보안 설정이나 파일의 차단 정보를 일괄 변경하지 않습니다.

`gongsa-note-windows-x64.zip`과 `update.json`은 계속 앱 안의 업데이트에 사용합니다. 업데이트 매니페스트의 파일명·크기·SHA-256은 **ZIP 기준**을 유지합니다. 설치 프로그램을 이 ZIP 파일 대신 지정하지 마세요.

## 빌드

Inno Setup 6.5 이상과 함께 제공되는 한국어 메시지 파일이 필요합니다. 먼저 `prepare_release.py`로 onedir 실행 폴더 및 두 기본 DB를 검증하고 ZIP·소스 ZIP·업데이트 파일을 생성합니다. 그때 검증한 동일한 실행 폴더를 설치 프로그램에 넣습니다.

PowerShell 예시:

```powershell
$compiler = 'C:\tools\Inno Setup 6\ISCC.exe'
$appSource = 'C:\release\공사노트'
$outputDir = 'C:\release\배포'
$version = '0.13.37'
& $compiler "/DAppVersion=$version" "/DAppSource=$appSource" "/DOutputDir=$outputDir" 'tools/gongsa-note-installer.iss'
if ($LASTEXITCODE -ne 0) { throw '설치 프로그램 빌드에 실패했습니다.' }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputDir 'gongsa-note-setup.exe')
```

생성 파일은 `gongsa-note-setup.exe`입니다. 버전 번호는 실행 폴더 안의 `release.json`, `_internal_버전` 폴더와 일치해야 합니다. 배포할 때 설치 EXE, 업데이트 ZIP, `update.json`, 소스 ZIP을 같은 정식 릴리스에 올립니다.

## 자료 보존과 확인

- 설치 대상 파일은 `공사노트.exe`와 해당 버전의 `_internal_...` 폴더뿐입니다. `공사노트 자료`, 저장한 `.gongsa` 파일, 사용자 DB와 백업은 설치하거나 삭제하지 않습니다.
- 같은 설치 위치에 새 버전을 설치해도 기존 자료는 유지합니다. 기존 ZIP 버전의 다른 폴더에 보관된 자료는 자동으로 옮기지 않습니다. 저장한 `.gongsa` 파일은 새 앱에서 열 수 있습니다.
- 실행 중인 공사노트가 있으면 설치와 제거가 중단되고 사용자가 먼저 저장·종료해야 합니다. 설치 프로그램은 앱을 강제로 닫지 않습니다.
- 제거는 설치 당시 기록된 프로그램 파일만 대상으로 합니다. 앱이 만든 자료나 다른 파일을 지우는 폴더 전체 삭제 규칙은 넣지 않습니다.
- `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`로 설치를 검증할 수 있습니다. 무인 설치에서는 앱이 자동 실행되지 않습니다.
- 실제 GitHub 다운로드본으로 설치한 뒤 화면이 열리는지 확인합니다. 설치된 EXE·런타임 파일을 검증한 원본과 비교하고 두 기본 DB 해시를 확인합니다. 테스트용 기존 자료를 둔 상태에서 재설치·제거 후에도 그대로 남는지 확인합니다.

Inno Setup의 [AppMutex](https://jrsoftware.org/ishelp/topic_setup_appmutex.htm), [현재 사용자 설치](https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm), [제거 파일 처리](https://jrsoftware.org/ishelp/topic_uninstalldeletesection.htm) 기준을 사용합니다.
