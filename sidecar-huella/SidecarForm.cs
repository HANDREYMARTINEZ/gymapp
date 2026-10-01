using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Forms;
using Fleck;
using Newtonsoft.Json.Linq;

namespace Enrollment
{
    // Ventana oculta que mantiene vivo el capturador de huella (DPFP lo necesita)
    // y expone un servidor WebSocket local para que Electron le hable.
    public class SidecarForm : Form, DPFP.Capture.EventHandler
    {
        // Token de reserva, solo para cuando se abre el sidecar a mano. En uso
        // normal lo manda Electron por linea de comandos y es distinto en cada
        // instalacion.
        private const string TOKEN_DE_RESERVA = "CAMBIA-ESTE-TOKEN";
        private const int PUERTO = 8383;

        private readonly string TokenEsperado;
        // Prioridad de adquisicion. Se puede fijar por linea de comandos para
        // poder comparar las tres sin recompilar: es lo unico que decide si el
        // lector entrega muestras a una ventana que no tiene el foco.
        //
        // Por defecto Low. Medido en esta maquina: High no se puede ni crear
        // ("Failed to create acquisition"), Normal se crea pero solo entrega
        // muestras a la ventana que tiene el foco -- que es justo lo que el
        // kiosco necesita para su PIN y por tanto no puede darnos. Low es la de
        // segundo plano.
        public static DPFP.Capture.Priority PrioridadPedida = DPFP.Capture.Priority.Low;

        private DPFP.Capture.Capture Capturer;
        private DPFP.Processing.Enrollment EnrollmentActual;
        private WebSocketServer Servidor;
        private IWebSocketConnection ConexionActiva;

        // "idle" | "enrolando" | "verificando"
        private string Modo = "idle";
        private int ClienteEnrolando = -1;
        private Dictionary<int, DPFP.Template> TemplatesCargados = new Dictionary<int, DPFP.Template>();

        public SidecarForm(string token) : this(token, false) { }

        public SidecarForm(string token, bool visible)
        {
            TokenEsperado = string.IsNullOrEmpty(token) ? TOKEN_DE_RESERVA : token;

            // Con "visible" la ventana se comporta como el ejemplo original de
            // DigitalPersona. Sirve para comprobar si esconderla es lo que impide
            // que el lector entregue las muestras, sin tener que recompilar.
            if (visible)
            {
                this.Text = "Sidecar de huella (modo visible)";
                this.Size = new System.Drawing.Size(420, 140);
                this.StartPosition = FormStartPosition.CenterScreen;
                this.TopMost = true;
                this.Load += SidecarForm_Load;
                // Con foco, como quedaba el ejemplo original al abrirlo. Si el
                // lector solo entrega muestras a la ventana activa, esto lo saca a
                // la luz.
                this.Shown += (s2, e2) => { this.Activate(); Anotar("Ventana visible y activada."); };
                Anotar("Arrancando en modo VISIBLE.");
                return;
            }

            // DPFP necesita una ventana viva para entregar los eventos del lector,
            // pero no necesita que se vea. Se deja fuera de la pantalla, sin borde,
            // transparente y fuera de la barra de tareas: sigue existiendo para
            // Windows y no existe para quien usa la app.
            this.FormBorderStyle = FormBorderStyle.None;
            this.ShowInTaskbar = false;
            this.StartPosition = FormStartPosition.Manual;
            this.Location = new System.Drawing.Point(-32000, -32000);
            this.Size = new System.Drawing.Size(1, 1);
            this.Opacity = 0;

            this.Load += SidecarForm_Load;
        }
        private void SidecarForm_Load(object sender, EventArgs e)
        {
            try
            {
                // La prioridad (ver PrioridadPedida) es la clave de todo esto, y
                // tiene que ser Low. NO cambiarla a High: High ni siquiera se crea
                // ("Failed to create acquisition"). Con Normal, la del constructor
                // sin argumentos que usaba el ejemplo del SDK, el lector solo
                // entrega las muestras a la ventana que esta en primer plano, y
                // esta ventana nunca lo esta: el foco lo necesita el kiosco para
                // el PIN. Low es la de segundo plano.
                //
                // Un "el lector toca pero no entrega huellas" NO se arregla
                // subiendo la prioridad: ver ToquesSinMuestra mas abajo.
                Anotar("Iniciando captura. Ventana oculta=" + (this.Opacity == 0));
                Capturer = new DPFP.Capture.Capture(PrioridadPedida);
                Anotar("Prioridad de captura: " + Capturer.Priority);
                Capturer.EventHandler = this;
                Capturer.StartCapture();
                Anotar("StartCapture() no lanzo excepcion.");
            }
            catch (Exception ex)
            {
                // Nada de MessageBox. Este proceso lo arranca la app sin ventana:
                // un cuadro modal aqui bloquearia el Load, el servidor WebSocket
                // no llegaria a levantarse, y en recepcion apareceria un dialogo
                // sin contexto encima del kiosco. Se anota y se sigue: el servidor
                // tiene que estar en pie aunque el lector no este conectado, para
                // que la app pueda preguntarle y responder que no hay lector.
                Anotar("No se pudo iniciar el lector (prioridad " + PrioridadPedida + "): " + ex.Message);
            }

            Anotar("Levantando WebSocket en el puerto " + PUERTO);
            Servidor = new WebSocketServer("ws://127.0.0.1:" + PUERTO);
            Servidor.Start(socket =>
            {
                // Si el atasco empezo antes de que la app se conectara (el kiosco
                // se abre y se cierra muchas veces al dia), se le dice al llegar.
                socket.OnOpen = () => { ConexionActiva = socket; if (AvisoDeAtasco) socket.Send(JsonAtasco()); };
                socket.OnClose = () => { ConexionActiva = null; };
                socket.OnMessage = mensaje => ManejarMensaje(socket, mensaje);
            });

        }


        private static void Anotar(string texto)
        {
            try
            {
                string carpeta = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GymApp");
                Directory.CreateDirectory(carpeta);
                File.AppendAllText(Path.Combine(carpeta, "sidecar.log"),
                    DateTime.Now.ToString("s") + "  " + texto + Environment.NewLine);
            }
            catch { /* si ni siquiera se puede anotar, no hay nada mas que hacer */ }
        }

        private void ManejarMensaje(IWebSocketConnection socket, string mensajeJson)
        {
            JObject msg;
            try { msg = JObject.Parse(mensajeJson); }
            catch { return; }

            string token = (string)msg["token"];
            if (token != TokenEsperado)
            {
                Anotar("Token rechazado. Llego uno de " + (token == null ? 0 : token.Length) + " caracteres.");
                socket.Send(JsonEvento("error", "token inválido"));
                socket.Close();
                return;
            }

            string accion = (string)msg["accion"];
            Anotar("Mensaje recibido: " + accion);

            if (accion == "enrolar")
            {
                ClienteEnrolando = (int)msg["clienteId"];
                EnrollmentActual = new DPFP.Processing.Enrollment();
                Modo = "enrolando";
                // Antes aqui habia this.Activate(). Con la ventana oculta no hace
                // falta, y era justo lo que dejaba al kiosco sin foco y obligaba a
                // devolverselo con un clic.
                socket.Send(JsonEvento("estado", "Esperando huella para enrolar cliente " + ClienteEnrolando));
            }
            else if (accion == "cargarTemplates")
            {
                TemplatesCargados.Clear();
                var lista = (JArray)msg["templates"];
                foreach (var item in lista)
                {
                    int clienteId = (int)item["clienteId"];
                    byte[] bytes = Convert.FromBase64String((string)item["templateBase64"]);
                    var template = new DPFP.Template(new MemoryStream(bytes));
                    TemplatesCargados[clienteId] = template;
                }
                Modo = "verificando";
                socket.Send(JsonEvento("estado", TemplatesCargados.Count + " huellas cargadas, listo para verificar"));
            }
            else if (accion == "detener")
            {
                Modo = "idle";
                socket.Send(JsonEvento("estado", "Detenido"));
            }
        }

        // --- DPFP.Capture.EventHandler ---

        // --- Deteccion de atasco ---
        //
        // Paso en el gimnasio el 30-sep-2026: desde las 12:20 el lector seguia
        // avisando cada dedo (OnFingerTouch / OnFingerGone) pero ya no entregaba
        // ninguna muestra (OnComplete). Nadie se entero hasta la noche: el kiosco
        // simplemente no reconocia a nadie. Desenchufar el lector y reiniciar este
        // proceso no lo arreglo; reiniciar el PC si.
        //
        // En uso normal cada toque termina en un OnComplete (aunque la huella salga
        // mala: la calidad se juzga despues). Varios toques seguidos sin ninguna
        // muestra es ese atasco, y se avisa a la app para que lo diga en pantalla.
        private const int TOQUES_PARA_ATASCO = 3;
        private int ToquesSinMuestra = 0;
        private bool AvisoDeAtasco = false;

        private string JsonAtasco()
        {
            return "{\"evento\":\"lectorAtascado\",\"toques\":" + ToquesSinMuestra + "}";
        }

        public void OnComplete(object Capture, string ReaderSerialNumber, DPFP.Sample Sample)
        {
            if (AvisoDeAtasco)
            {
                Anotar("RECUPERADO: vuelve a llegar una muestra despues de " + ToquesSinMuestra + " toques sin ninguna.");
                Enviar("{\"evento\":\"lectorRecuperado\"}");
            }
            AvisoDeAtasco = false;
            ToquesSinMuestra = 0;
            Anotar("OnComplete: llego una muestra. Modo=" + Modo);
            if (Modo == "enrolando") ProcesarEnrolamiento(Sample);
            else if (Modo == "verificando") ProcesarVerificacion(Sample);
            else Anotar("  ...y se descarta: el modo es '" + Modo + "', nadie la pidio.");
        }

        private void ProcesarEnrolamiento(DPFP.Sample Sample)
        {
            var feedback = DPFP.Capture.CaptureFeedback.None;
            var features = new DPFP.FeatureSet();
            new DPFP.Processing.FeatureExtraction().CreateFeatureSet(Sample, DPFP.Processing.DataPurpose.Enrollment, ref feedback, ref features);

            if (feedback != DPFP.Capture.CaptureFeedback.Good)
            {
                Anotar("Enrolamiento: muestra descartada, calidad=" + feedback);
                Enviar(JsonEvento("estado", "Muestra no valida (" + feedback + "), vuelve a poner el dedo"));
                return;
            }

            try
            {
                EnrollmentActual.AddFeatures(features);
            }
            catch (Exception ex) { Anotar("Enrolamiento: AddFeatures fallo: " + ex.Message); return; }

            if (EnrollmentActual.TemplateStatus == DPFP.Processing.Enrollment.Status.Ready)
            {
                using (var ms = new MemoryStream())
                {
                    EnrollmentActual.Template.Serialize(ms);
                    string b64 = Convert.ToBase64String(ms.ToArray());
                    Enviar(JsonTemplateListo(ClienteEnrolando, b64));
                }
                Modo = "idle";
            }
            else
            {
                Enviar(JsonEvento("estado", "Muestra " + (EnrollmentActual.FeaturesNeeded) + " restantes"));
            }
        }

        private void ProcesarVerificacion(DPFP.Sample Sample)
        {
            var feedback = DPFP.Capture.CaptureFeedback.None;
            var features = new DPFP.FeatureSet();
            new DPFP.Processing.FeatureExtraction().CreateFeatureSet(Sample, DPFP.Processing.DataPurpose.Verification, ref feedback, ref features);

            if (feedback != DPFP.Capture.CaptureFeedback.Good)
            {
                Anotar("Verificacion: muestra descartada, calidad=" + feedback);
                return;
            }

            var verificador = new DPFP.Verification.Verification();
            foreach (var par in TemplatesCargados)
            {
                var resultado = new DPFP.Verification.Verification.Result();
                verificador.Verify(features, par.Value, ref resultado);
                if (resultado.Verified)
                {
                    Enviar("{\"evento\":\"match\",\"clienteId\":" + par.Key + "}");
                    return;
                }
            }
            Enviar(JsonEvento("evento", "sinMatch"));
        }

        private void Enviar(string json)
        {
            if (ConexionActiva != null) ConexionActiva.Send(json);
        }

        private string JsonEvento(string clave, string valor)
        {
            return "{\"" + clave + "\":\"" + valor.Replace("\"", "'") + "\"}";
        }

        private string JsonTemplateListo(int clienteId, string templateBase64)
        {
            return "{\"evento\":\"templateListo\",\"clienteId\":" + clienteId + ",\"templateBase64\":\"" + templateBase64 + "\"}";
        }

        public void OnFingerGone(object Capture, string ReaderSerialNumber) { Anotar("OnFingerGone"); Enviar(JsonEvento("estado", "dedo retirado")); }
        public void OnFingerTouch(object Capture, string ReaderSerialNumber)
        {
            Anotar("OnFingerTouch");
            Enviar(JsonEvento("estado", "dedo detectado"));

            ToquesSinMuestra++;
            if (ToquesSinMuestra < TOQUES_PARA_ATASCO) return;
            // Se anota una sola vez (no una linea por toque durante horas), pero se
            // avisa en cada toque: es barato y cubre una app que se acaba de conectar.
            if (!AvisoDeAtasco)
                Anotar("ATASCO: " + ToquesSinMuestra + " toques seguidos sin ninguna muestra. " +
                       "El lector ve el dedo pero no entrega la huella.");
            AvisoDeAtasco = true;
            Enviar(JsonAtasco());
        }
        public void OnReaderConnect(object Capture, string ReaderSerialNumber) { Anotar("OnReaderConnect: " + ReaderSerialNumber); Enviar(JsonEvento("estado", "lector conectado")); }
        public void OnReaderDisconnect(object Capture, string ReaderSerialNumber) { Anotar("OnReaderDisconnect"); Enviar(JsonEvento("estado", "lector desconectado")); }
        public void OnSampleQuality(object Capture, string ReaderSerialNumber, DPFP.Capture.CaptureFeedback CaptureFeedback)
        {
            Anotar("OnSampleQuality: " + CaptureFeedback);
        }
    }
}