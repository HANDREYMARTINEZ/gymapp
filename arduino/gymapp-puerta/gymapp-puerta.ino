/*
  GymApp - control de la puerta
  Arduino Nano V3.0 (FT232) + modulo rele de 1 canal + electroiman de 12 V

  QUE HACE
  --------
  Escucha por USB. Cuando GymApp le manda ABRIR, activa el rele durante unos
  segundos y lo vuelve a soltar. El rele va en NC (normalmente cerrado) en
  serie con los 12 V del electroiman, asi que "activar el rele" significa
  CORTARLE la corriente al iman, y el iman suelta la placa.

  POR QUE LOS SEGUNDOS SE CUENTAN AQUI Y NO EN EL PC
  -------------------------------------------------
  Porque el PC se puede colgar, se puede quedar sin bateria o le pueden
  desenchufar el USB justo despues de mandar la orden. Si el cierre dependiera
  de un segundo mensaje ("ya, cierra"), cualquiera de esas tres cosas dejaria
  la puerta de la calle abierta toda la noche. Aqui, en cuanto pasan los
  milisegundos pedidos, la placa cierra sola aunque no haya nadie al otro lado.

  POR QUE EL RELE NO VA EN EL PIN 13
  ----------------------------------
  El pin 13 es el del LED de la placa, y el gestor de arranque (bootloader) lo
  hace parpadear cada vez que el Nano se resetea -- que es cada vez que alguien
  abre el puerto serie. Con el rele ahi, la puerta daria un golpe de apertura
  al abrir la app. El rele va al pin 7; el 13 se queda como testigo visual, que
  ademas permite probar todo esto sin tener aun el rele conectado.

  PROTOCOLO (texto, una orden por linea, 9600 baudios)
  ----------------------------------------------------
    PING        -> GYMAPP-PUERTA v1 LISTA
    ABRIR       -> abre el tiempo por defecto
    ABRIR:5000  -> abre 5000 ms (se recorta a un maximo de 20 s)
    CERRAR      -> cierra ya, sin esperar
    ESTADO      -> ABIERTA:<ms que faltan>  o  CERRADA

  La firma de PING no es ceremonia: en un COM cualquiera puede haber una
  impresora de tiquetes o un lector de codigos. GymApp solo le manda ordenes a
  quien se identifica con esta firma exacta.
*/

const char FIRMA[] = "GYMAPP-PUERTA v1";

const uint8_t PIN_RELE   = 7;   // al IN del modulo rele
const uint8_t PIN_TESTIGO = 13; // LED de la placa: encendido = puerta suelta

// Casi todos los modulos rele chinos son de disparo por nivel BAJO: el rele se
// activa cuando su entrada IN se pone a 0 V. Si el tuyo es de los otros (se
// activa con 5 V), cambia esto a false y vuelve a grabar. Se nota enseguida:
// con el valor equivocado la puerta esta suelta en reposo y se cierra durante
// los cinco segundos, justo al reves.
const bool RELE_ACTIVO_EN_BAJO = true;

// Topes de seguridad. El maximo es el que importa: por muy roto que este el
// software del PC, no puede pedir que la puerta se quede abierta indefinida.
const unsigned long MS_POR_DEFECTO = 5000;
const unsigned long MS_MINIMO      = 500;
const unsigned long MS_MAXIMO      = 20000;

bool abierta = false;
unsigned long cierraEn = 0;

char linea[24];
uint8_t largo = 0;

// Reposo = rele en calma = electroiman con corriente = puerta CERRADA.
// Es importante que el reposo sea el estado cerrado y no al reves: asi un
// Arduino recien reseteado, o colgado, deja la puerta cerrada.
inline void escribirRele(bool activar) {
  digitalWrite(PIN_RELE, activar ? (RELE_ACTIVO_EN_BAJO ? LOW : HIGH)
                                 : (RELE_ACTIVO_EN_BAJO ? HIGH : LOW));
}

void cerrarPuerta() {
  escribirRele(false);
  digitalWrite(PIN_TESTIGO, LOW);
  abierta = false;
}

void abrirPuerta(unsigned long ms) {
  if (ms < MS_MINIMO) ms = MS_MINIMO;
  if (ms > MS_MAXIMO) ms = MS_MAXIMO;
  escribirRele(true);
  digitalWrite(PIN_TESTIGO, HIGH);
  abierta = true;
  cierraEn = millis() + ms;
  Serial.print(F("ABIERTA:"));
  Serial.println(ms);
}

void setup() {
  // El orden importa. Se deja escrito el valor de reposo ANTES de convertir el
  // pin en salida: al reves, el pin pasa por un instante a 0 V y el rele da un
  // chasquido -- es decir, la puerta se abre un parpadeo cada vez que arranca
  // la placa.
  escribirRele(false);
  pinMode(PIN_RELE, OUTPUT);
  escribirRele(false);

  pinMode(PIN_TESTIGO, OUTPUT);
  digitalWrite(PIN_TESTIGO, LOW);

  Serial.begin(9600);
  // Saludo de arranque: GymApp abre el puerto, eso resetea la placa, y este
  // mensaje le dice "ya estoy" sin que tenga que esperar a preguntar.
  Serial.print(FIRMA);
  Serial.println(F(" LISTA"));
}

void atender(const char *orden) {
  if (strcmp(orden, "PING") == 0) {
    Serial.print(FIRMA);
    Serial.println(F(" LISTA"));
    return;
  }

  if (strncmp(orden, "ABRIR", 5) == 0) {
    unsigned long ms = MS_POR_DEFECTO;
    if (orden[5] == ':') ms = strtoul(orden + 6, NULL, 10);
    abrirPuerta(ms);
    return;
  }

  if (strcmp(orden, "CERRAR") == 0) {
    cerrarPuerta();
    Serial.println(F("CERRADA"));
    return;
  }

  if (strcmp(orden, "ESTADO") == 0) {
    if (abierta) {
      Serial.print(F("ABIERTA:"));
      Serial.println(cierraEn - millis());
    } else {
      Serial.println(F("CERRADA"));
    }
    return;
  }

  Serial.println(F("NO ENTIENDO"));
}

void loop() {
  // El cierre va primero y no depende de que llegue nada por el puerto: es la
  // parte de la que depende que la puerta no se quede abierta.
  //
  // La resta con signo es la forma correcta de comparar millis(): a los 49 dias
  // el contador vuelve a cero, y un "millis() >= cierraEn" a secas dejaria la
  // puerta abierta hasta que diera la vuelta entera. Un gimnasio que no apaga
  // el equipo llega a los 49 dias sin despeinarse.
  if (abierta && (long)(millis() - cierraEn) >= 0) {
    cerrarPuerta();
    Serial.println(F("CERRADA"));
  }

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (largo > 0) {
        linea[largo] = '\0';
        atender(linea);
        largo = 0;
      }
    } else if (largo < sizeof(linea) - 1) {
      linea[largo++] = c;
    } else {
      // Linea mas larga de lo que cabe: se tira entera en vez de partirla en
      // dos ordenes, que podria inventarse un ABRIR que nadie pidio.
      largo = 0;
    }
  }
}
