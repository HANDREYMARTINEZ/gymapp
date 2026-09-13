; Personalizacion del instalador de GymApp (electron-builder la recoge sola
; desde build/installer.nsh).
;
; QUE HACE
; --------
; Anade "Desinstalar GymApp de este equipo" a la pagina "Elegir opciones de
; instalacion / ¿Para quien se instalara esta aplicacion?", pero SOLO cuando ya
; hay una instalacion. Antes, desde el instalador solo se podia reinstalar; para
; quitar la app habia que ir a Configuracion de Windows.
;
; COMO SE ENGANCHA
; ----------------
; Esa pagina no es nuestra: es una plantilla de electron-builder
; (app-builder-lib/templates/nsis/multiUserUi.nsh). La plantilla llama a
; MUI_PAGE_FUNCTION_CUSTOM SHOW justo antes de mostrarse y LEAVE al salir, y esa
; macro de Modern UI 2 ejecuta la funcion que diga MUI_PAGE_CUSTOMFUNCTION_SHOW /
; _LEAVE si esta definida, y luego la olvida. Se definen en customWelcomePage,
; que electron-builder inserta justo ANTES de esa pagina. Las funciones se
; escriben en customPageAfterChangeDir, que va DESPUES, porque usan variables
; que la plantilla declara dentro de la propia pagina.
;
; LOS DATOS NO SE BORRAN
; ----------------------
; El desinstalador solo borra la carpeta de datos si recibe --delete-app-data o
; si package.json dice deleteAppDataOnUninstall: true (dice false, a proposito:
; Roaming\GymApp y Roaming\gymapp son la misma carpeta en Windows, la de los
; clientes). Aqui se le llama SIN ese parametro, y visible, igual que si se
; abriera desde Configuracion de Windows.
;
; LA CARPETA QUE SE DESINSTALA
; ----------------------------
; La misma que la pagina muestra ("Ya hay una instalacion por usuario (...)"),
; con el desinstalador que hay DENTRO de ella. No la del registro de Windows: ya
; paso una vez que esa entrada apuntaba a una instalacion vieja, y desinstalar
; desde ahi habria dejado la buena huerfana.
;
; OJO: electron-builder compila con los avisos como errores. Una variable o una
; funcion declarada y no usada rompe el build, por eso todo va dentro de
; !ifndef BUILD_UNINSTALLER (el desinstalador se compila aparte).

!ifndef BUILD_UNINSTALLER

Var GymappRadioDesinstalar
Var GymappCarpetaInstalada

!macro customWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW GymappOpcionDesinstalarShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE GymappOpcionDesinstalarLeave
!macroend

!macro customPageAfterChangeDir

Function GymappOpcionDesinstalarShow
  StrCpy $GymappCarpetaInstalada ""
  ${if} $hasPerUserInstallation == "1"
    StrCpy $GymappCarpetaInstalada "$perUserInstallationFolder"
  ${elseif} $hasPerMachineInstallation == "1"
    StrCpy $GymappCarpetaInstalada "$perMachineInstallationFolder"
  ${endif}

  ; Instalacion nueva, o una carpeta que ya no tiene desinstalador: no hay nada
  ; que ofrecer y la pagina queda como siempre.
  ${if} $GymappCarpetaInstalada == ""
    Return
  ${endif}
  ${IfNot} ${FileExists} "$GymappCarpetaInstalada\${UNINSTALL_FILENAME}"
    StrCpy $GymappCarpetaInstalada ""
    Return
  ${EndIf}

  ; Entre "Solo para mi" (50u) y el texto de abajo (110u). Al crearse despues de
  ; los otros dos radios queda en su mismo grupo: elegir uno desmarca los demas.
  ${NSD_CreateRadioButton} 10u 72u 280u 20u "Desinstalar GymApp de este equipo"
  Pop $GymappRadioDesinstalar
  ${NSD_OnClick} $GymappRadioDesinstalar GymappAlElegirDesinstalar

  ; Los otros dos radios siguen llamando a la funcion de la plantilla que
  ; escribe el texto de abajo, pero antes se le devuelve al boton su "Siguiente".
  ${NSD_OnClick} $MultiUser.InstallModePage.CurrentUser GymappAlElegirInstalar
  ${NSD_OnClick} $MultiUser.InstallModePage.AllUsers GymappAlElegirInstalar
FunctionEnd

Function GymappAlElegirDesinstalar
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Desinstalar"
  SendMessage $0 ${BCM_SETSHIELD} 0 0
  SendMessage $RadioButtonLabel1 ${WM_SETTEXT} 0 "STR:Se desinstalará GymApp de:$\r$\n$GymappCarpetaInstalada$\r$\n$\r$\nTus clientes, membresías, pagos y respaldos NO se borran: vuelven a aparecer si instalas GymApp otra vez."
FunctionEnd

Function GymappAlElegirInstalar
  ; La direccion del radio pulsado sigue en la pila: la recoge InstModeChange.
  GetDlgItem $2 $HWNDPARENT 1
  SendMessage $2 ${WM_SETTEXT} 0 "STR:$(^NextBtn)"
  Call InstModeChange
FunctionEnd

Function GymappOpcionDesinstalarLeave
  ${if} $GymappCarpetaInstalada == ""
    Return
  ${endif}
  ${NSD_GetState} $GymappRadioDesinstalar $0
  ${if} $0 != ${BST_CHECKED}
    Return
  ${endif}

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Desinstalar GymApp de este equipo?$\r$\n$\r$\n$GymappCarpetaInstalada$\r$\n$\r$\nTus clientes, membresías, pagos y respaldos NO se borran." IDYES GymappSiDesinstalar
  Abort

  GymappSiDesinstalar:
  ${if} $GymappCarpetaInstalada == "$perUserInstallationFolder"
    StrCpy $1 "/currentuser"
  ${else}
    StrCpy $1 "/allusers"
  ${endif}

  ClearErrors
  Exec '"$GymappCarpetaInstalada\${UNINSTALL_FILENAME}" $1'
  ${if} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "No se pudo abrir el desinstalador:$\r$\n$GymappCarpetaInstalada\${UNINSTALL_FILENAME}"
    Abort
  ${endif}

  ; El desinstalador sigue por su cuenta, con sus propias ventanas.
  Quit
FunctionEnd

!macroend

!endif
