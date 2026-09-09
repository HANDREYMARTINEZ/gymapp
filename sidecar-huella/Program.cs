using System;
using System.IO;
using System.Windows.Forms;

namespace Enrollment
{
    static class Program
    {
        // La carpeta de instalacion (Program Files) es de solo lectura para el
        // usuario normal, asi que los errores se anotan en su perfil.
        static void Anotar(string texto)
        {
            try
            {
                string carpeta = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GymApp");
                Directory.CreateDirectory(carpeta);
                File.AppendAllText(Path.Combine(carpeta, "sidecar.log"),
                    DateTime.Now.ToString("s") + "  " + texto + Environment.NewLine);
            }
            catch { }
        }

        [STAThread]
        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                Anotar(e.ExceptionObject.ToString());
            };
            Application.ThreadException += (s, e) =>
            {
                Anotar(e.Exception.ToString());
            };

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            // El token compartido llega por linea de comandos desde Electron. Si no
            // viene (por ejemplo al ejecutarlo a mano desde Visual Studio) se usa
            // el de siempre, para no romper esa forma de probarlo.
            bool visible = Array.IndexOf(args, "visible") >= 0;

            foreach (string a in args)
            {
                if (a == "prio=low") SidecarForm.PrioridadPedida = DPFP.Capture.Priority.Low;
                else if (a == "prio=high") SidecarForm.PrioridadPedida = DPFP.Capture.Priority.High;
                else if (a == "prio=normal") SidecarForm.PrioridadPedida = DPFP.Capture.Priority.Normal;
            }

            // "muestra" abre el ejemplo original de DigitalPersona, tal cual venia
            // en el SDK, pero con estas mismas DLL y en este mismo ejecutable. Si
            // el lector responde aqui y no en el sidecar, el problema es nuestro;
            // si no responde ni aqui, es del equipo o del driver.
            if (Array.IndexOf(args, "muestra") >= 0)
            {
                Anotar("Arrancando el ejemplo original del SDK (modo muestra).");
                Application.Run(new MainForm());
                return;
            }

            Application.Run(new SidecarForm(args.Length > 0 ? args[0] : null, visible));
        }
    }
}