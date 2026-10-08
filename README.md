# GymApp

Aplicación de escritorio para la administración de un gimnasio: clientes,
membresías, control de acceso, punto de venta, inventario y caja. Funciona sin
conexión a internet: todo vive en una base SQLite dentro del propio PC del
mostrador.

En producción desde septiembre de 2026.

Desarrollada por **H.A.M.C Solutions**.

---

## Qué hace

- **Clientes y membresías.** Ficha con foto, documento, planes por días o por
  tiquetes, renovaciones, reingresos y pagos a crédito (fiados) con una sola
  cuenta por cliente.
- **Control de acceso.** Un kiosco a pantalla completa donde el cliente entra
  con **huella**, con **código de barras** del carnet o con un **PIN**. La
  entrada queda registrada con su motivo. Con dos monitores, el kiosco se abre
  en el de los clientes (botón o F2) mientras recepción sigue vendiendo en el
  otro: los dos comparten el mismo lector de huella. Con tres o más monitores se
  elige en cuál sale, y se recoloca solo si se conecta o desconecta alguno.
- **Puerta.** Un relé gobernado por una placa Arduino abre el torniquete cuando
  el acceso es válido. Los 5 segundos de apertura los cuenta la placa, no el PC.
- **Punto de venta e inventario.** Productos con código de barras, sabores,
  movimientos de mercancía y ventas, con fiado.
- **Caja.** Apertura y cierre por turno, con el detalle de cada movimiento y los
  medios de pago.
- **Recordatorios por correo.** Aviso automático a quien está por vencer o ya
  venció, con varios frenos para no escribirle dos veces a nadie.
- **Importar y exportar en Excel.** Alta masiva de clientes y volcado del padrón.
- **Respaldos.** Copia en caliente de la base (WAL) y restauración verificada.
- **Panel de desarrollador.** Herramientas de mantenimiento con cinco frenos
  para que nada destructivo ocurra por accidente.

Los datos sensibles de los clientes se guardan cifrados; las contraseñas de los
usuarios, con Argon2.

---

## Capturas

Todas salen de `npm run capturas`, que siembra una base temporal con **datos de
ejemplo** (ningún cliente real) y recorre la app de verdad pantalla por pantalla.
Están todas en [`docs/capturas`](docs/capturas).

### Acceso

| Login | Kiosco |
|---|---|
| ![Login](docs/capturas/01-login.png) | ![Kiosco](docs/capturas/02-kiosco.png) |

### Clientes

| Lista de clientes | Ficha del cliente |
|---|---|
| ![Clientes](docs/capturas/03-clientes.png) | ![Ficha](docs/capturas/04-cliente-ficha.png) |
| **Cobrar desde la lista** | **Nuevo cliente** |
| ![Cobrar](docs/capturas/03b-clientes-cobrar.png) | ![Nuevo cliente](docs/capturas/04b-cliente-nuevo.png) |
| **Cliente que debe** | **Fiar una membresía** |
| ![Debe](docs/capturas/04d-ficha-debe.png) | ![Fiar](docs/capturas/04e-ficha-fiar.png) |

### Punto de venta y caja

| Vender | Carrito |
|---|---|
| ![Vender](docs/capturas/05-vender.png) | ![Carrito](docs/capturas/06-vender-carrito.png) |
| **Venta fiada** | **Caja** |
| ![Fiado](docs/capturas/06b-vender-fiado.png) | ![Caja](docs/capturas/07-caja.png) |
| **Detalle de una venta** | **Anular una venta** |
| ![Detalle](docs/capturas/07b-venta-detalle.png) | ![Anular](docs/capturas/07c-venta-anular.png) |

### Planes e inventario

| Planes | Inventario |
|---|---|
| ![Planes](docs/capturas/10-planes.png) | ![Inventario](docs/capturas/11-inventario.png) |
| **Entrada de mercancía** | **Salida de mercancía** |
| ![Entrada](docs/capturas/12b-inventario-entrada.png) | ![Salida](docs/capturas/12c-inventario-salida.png) |

### Dashboards

| Resumen | Lo más vendido |
|---|---|
| ![Dashboards](docs/capturas/13-dashboards.png) | ![Vendido](docs/capturas/14-dashboards-vendido.png) |

### Sistema

| Usuarios | Configuración |
|---|---|
| ![Usuarios](docs/capturas/15-usuarios.png) | ![Configuración](docs/capturas/16-configuracion.png) |
| **Puerta automática** | **Recordatorios por correo** |
| ![Puerta](docs/capturas/16b-configuracion-puerta.png) | ![Recordatorios](docs/capturas/16d-configuracion-recordatorios.png) |
| **Panel de desarrollador** | **Borrar planes** |
| ![Desarrollador](docs/capturas/18-desarrollador.png) | ![Planes](docs/capturas/18b-desarrollador-planes.png) |

---

## Requisitos

- **Windows 10 o superior.** Electron 44 no arranca en Windows 7: da "no es una
  aplicación Win32 válida".
- **Node.js 20+**.
- Para compilar el sidecar de la huella: **Visual Studio / .NET SDK** y el
  **SDK de DigitalPersona One Touch for Windows**.

### Hardware

Nada de esto es obligatorio para desarrollar — la app arranca sin ello —, pero sí
para el gimnasio:

| Pieza | Para qué |
|---|---|
| Lector de huella DigitalPersona | Entrada por huella |
| Lector de códigos de barras | Entrada por carnet y venta de productos. Es un teclado HID: se detecta por la velocidad de tecleo (~2 ms por tecla) |
| Cámara | Foto de la ficha del cliente |
| Placa Arduino + relé | Apertura de la puerta. El relé va en **NC** |

---

## Puesta en marcha

```bash
npm install
npm run dev
```

Todos los comandos se corren desde esta carpeta (`gymapp/`), que es donde está el
`package.json`.

`npm run dev` levanta Vite y Electron a la vez. Al cerrar la ventana el proceso
termina con exit 1: es `concurrently -k` matando Vite, no un fallo.

### Pruebas

```bash
npm test
npm run test:produccion
```

Las dos suites deben terminar en exit code 0 antes de dar nada por cerrado. Las
pruebas corren sobre Electron, no sobre Node a secas.

> Si `test/sidecar.js` falla, mira primero el **puerto 8383**: una instancia
> abierta de la app lanza su propio `SidecarHuella.exe` y lo ocupa, y entonces
> esa suite da cuatro fallos que parecen del lector.

### Instalador

```bash
npm run build
```

Antes de generar el instalador hay que **compilar el sidecar de la huella**, que
no se versiona:

```bash
dotnet msbuild "EnrollmentSample CS.csproj" -t:Rebuild -p:Configuration=Release
```

`bin/Release` es lo que electron-builder copia al instalador vía
`extraResources`, así que en un clon nuevo ese paso va primero.

#### Sidecar de la huella: las DLL de DigitalPersona

El repositorio **no incluye** las DLL del SDK de DigitalPersona: son software
propietario de otra empresa. Para compilar el sidecar hay que instalar el
**DigitalPersona One Touch for Windows SDK** (probado con la 1.6.1) y copiar a
`sidecar-huella/libs/` estas ocho, que el `.csproj` busca ahí:

```
DPFPCtlXTypeLibNET.dll   DPFPCtlXWrapperNET.dll   DPFPDevNET.dll
DPFPEngNET.dll           DPFPGuiNET.dll           DPFPShrNET.dll
DPFPShrXTypeLibNET.dll   DPFPVerNET.dll
```

Sin ellas el resto de la app compila y funciona igual; lo único que falta es la
entrada por huella.

---

## Estructura

```
electron/          Proceso principal
  crypto/          Cifrado de datos sensibles
  db/              SQLite, migraciones y repositorios
  ipc/             Canales expuestos al renderer
  services/        Huellas, puerta, correo, respaldos, Excel, membresías…
src/               Interfaz en React
  screens/         Pantallas (Kiosco, Caja, POS, Clientes, Configuración…)
sidecar-huella/    Proceso .NET que habla con el SDK de DigitalPersona
arduino/           Firmware de la placa que abre la puerta
scripts/           Diagnósticos de cámara, lector, huella y puerta
test/              Suites de prueba
```

### Diagnósticos

Cuando algo del hardware no responde, antes de tocar código:

```bash
npm run huella     # lector de huella
npm run lector     # lector de códigos de barras
npm run puerta     # placa y relé
npm run camara     # cámaras disponibles
```

En esta máquina hay **tres cámaras** y la que Windows da por defecto no arranca:
conviene mirar `npm run camara` antes de dar por rota la captura de foto.

No se le puede hablar a la placa mientras está en el bootloader, justo después de
conectarla o de subirle el firmware.

---

## Licencia

Software propietario. Todos los derechos reservados — ver [LICENSE](LICENSE).

El código es visible para consulta, pero eso no da permiso para usarlo,
copiarlo ni distribuirlo.

Las DLL del SDK de **DigitalPersona** no están en el repositorio (ver
"Sidecar de la huella" más arriba) y se rigen por su propia licencia.
