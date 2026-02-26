using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Threading;
using System.Linq;
using BepInEx;
using UnityEngine;

// Namespaces confirmados nos ficheiros do jogo
using Newtonsoft.Json; // Adicione este
using YARG.Song;
using YARG.Core.Song;
using YARG.Menu;
using YARG.Core.Utility;

namespace YargRemoteMod
{ // Namespace name is already English-like, keeping it as is.
    [BepInPlugin("com.gugutab.yarg.remote", "YARG Remote", "1.1.0")]
    public class YargRemotePlugin : BaseUnityPlugin
    {
        private HttpListener _listener;
        private Thread _serverThread;
        private bool _isRunning;
        
        // Fila segura para transferir ações do Servidor HTTP para a Thread Principal do Unity
        private readonly ConcurrentQueue<Action> _mainThreadActions = new ConcurrentQueue<Action>();

        private void Awake()
        {
            Logger.LogInfo("=======================================");
            Logger.LogInfo("YARG Remote Server Iniciando...");
            Logger.LogInfo("=======================================");
            
            // Inicia o servidor na porta 8080 (pode alterar se quiser)
            StartServer(8080); 
        }

        private void StartServer(int port)
        {
            try
            {
                _listener = new HttpListener();
                // O prefixo "+" permite conexões de qualquer IP da sua rede LAN
                _listener.Prefixes.Add($"http://+:{port}/"); 
                _listener.Start();
                _isRunning = true;

                // Inicia o servidor em uma Thread separada para não travar o jogo
                _serverThread = new Thread(ServerLoop)
                {
                    IsBackground = true,
                    Name = "YargRemoteServerThread"
                };
                _serverThread.Start();

                Logger.LogInfo($"[YARG Remote] Escutando comandos na rede em http://localhost:{port}/");
            }
            catch (Exception ex)
            {
                Logger.LogError($"[YARG Remote] Erro crítico ao iniciar porta {port}: {ex.Message}");
                Logger.LogError("DICA: Inicie o jogo como Administrador se a porta estiver sendo negada pelo Windows.");
            }
        }

        private void ServerLoop()
        {
            while (_isRunning && _listener.IsListening)
            {
                try
                {
                    // Pausa a thread até receber uma requisição HTTP
                    var context = _listener.GetContext();
                    ProcessRequest(context);
                }
                catch (HttpListenerException)
                {
                    // Exceção normal disparada quando forçamos o _listener a parar no OnDestroy()
                    break;
                }
                catch (Exception ex)
                {
                    Logger.LogError($"[YARG Remote] HTTP read error: {ex.Message}");
                }
            }
        }

        private void ProcessRequest(HttpListenerContext context) // Method name is already English, keeping it as is.
        {
            var request = context.Request;
            var response = context.Response;
            
            // CORS header to allow calls from browsers or external apps via LAN
            response.AppendHeader("Access-Control-Allow-Origin", "*");
            response.AppendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            
            if (request.HttpMethod == "OPTIONS")
            {
                SendResponse(response, 200, "OK");
                return;
            }

            string path = request.Url?.AbsolutePath.ToLower() ?? "";
            Logger.LogInfo($"[YARG Remote] New request: {request.HttpMethod} {path}");

            try
            {
                // API ROUTING
                if (path == "/" || path == "/index.html")
                {
                    string pluginDir = System.IO.Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
                    string indexPath = System.IO.Path.Combine(pluginDir, "index.html");

                    if (System.IO.File.Exists(indexPath))
                    {
                        string htmlContent = System.IO.File.ReadAllText(indexPath);
                        SendResponse(response, 200, htmlContent, "text/html");
                    }
                    else
                    {
                        Logger.LogWarning($"[YARG Remote] index.html not found in: {indexPath}");
                        SendResponse(response, 404, "{\"status\": \"error\", \"message\": \"index.html not found\"}");
                    }
                }
                if (path == "/ping")
                {
                    SendResponse(response, 200, "{\"status\": \"ok\", \"game\": \"YARG\", \"mod\": \"YARG Remote Server\"}");
                }
                else if (path == "/play" && request.HttpMethod == "POST")
                {
                    string songId = request.QueryString["song"];
                    if (string.IsNullOrEmpty(songId))
                    {
                        SendResponse(response, 400, "{\"status\": \"error\", \"message\": \"Missing parameter ?song=id\"}");
                        return;
                    }
                    
                    // THE MAGIC HAPPENS HERE: Instead of running the command here (which would crash Unity),
                    // we enqueue the action for the game's main thread (Update) to execute.
                    _mainThreadActions.Enqueue(() => PlaySong(songId));
                    
                    SendResponse(response, 200, $"{{\"status\": \"ok\", \"message\": \"Song {songId} sent to game queue!\"}}");
                }
                else if (path == "/songs" && request.HttpMethod == "GET")
                {
                    // Usamos SongContainer.Songs que você confirmou existir
                    var allSongs = SongContainer.Songs; 

                    if (allSongs == null || allSongs.Length == 0) {
                        SendResponse(response, 200, "[]"); 
                        return;
                    }

                    // We create the list of objects before the loop
                    var songDataList = new List<object>();
                    
                    // We get the count of the original Array
                    int totalCount = allSongs.Length;
                    int limit = Math.Min(totalCount, 5000);

                    var instruments = (YARG.Core.Instrument[])Enum.GetValues(typeof(YARG.Core.Instrument));
                    var difficulties = (YARG.Core.Difficulty[])Enum.GetValues(typeof(YARG.Core.Difficulty));

                    for (int i = 0; i < limit; i++)
                    {
                        var s = allSongs[i];
                        // TECHNICAL CORRECTION:
                        // 1. SortString is a struct, so we only use .Name without the '?'
                        // 2. Year and SongLength are inside the game's internal class
                        
                        var parts = new List<object>();
                        foreach (var inst in instruments)
                        {
                            if (inst == YARG.Core.Instrument.Band) continue;

                            var diffs = new List<string>();
                            foreach (var diff in difficulties)
                            {
                                if (s.HasDifficultyForInstrument(inst, diff))
                                {
                                    diffs.Add(diff.ToString());
                                }
                            }

                            if (diffs.Count > 0)
                            {
                                parts.Add(new {
                                    icon = inst.ToString(),
                                    difficulties = diffs
                                });
                            }
                        }

                        songDataList.Add(new {
                            id = s.Hash.GetHashCode().ToString(),
                            fullHash = s.Hash.ToString(),
                            name = RichTextUtils.StripRichTextTags(s.Name),
                            artist = RichTextUtils.StripRichTextTags(s.Artist),
                            album = RichTextUtils.StripRichTextTags(s.Album),
                            genre = RichTextUtils.StripRichTextTags(s.Genre),
                            subgenre = RichTextUtils.StripRichTextTags(s.Subgenre),
                            charter = RichTextUtils.StripRichTextTags(s.Charter),
                            playlist = RichTextUtils.StripRichTextTags(s.Playlist),
                            source = RichTextUtils.StripRichTextTags(s.Source),
                            parts = parts,
                            isMaster = s.IsMaster,
                            year = s.YearAsNumber == int.MaxValue ? "-" : s.YearAsNumber.ToString(),
                            duration = $"{(long)(s.SongLengthMilliseconds / 1000 / 60)}:{(long)(s.SongLengthMilliseconds / 1000 % 60):D2}"
                        });
                    }

                    // Serializes the list that was populated in the loop
                    string json = JsonConvert.SerializeObject(songDataList);

                    SendResponse(response, 200, json);
                }
                else
                {
                    SendResponse(response, 404, "{\"status\": \"error\", \"message\": \"Command not found\"}");
                }
            }
            catch (Exception ex)
            { // Method name is already English, keeping it as is.
                Logger.LogError($"[YARG Remote] Processing error: {ex}");
                SendResponse(response, 500, "{\"status\": \"error\", \"message\": \"Internal mod error\"}");
            }
        }

        private void SendResponse(HttpListenerResponse response, int statusCode, string payload, string contentType = "application/json") // Method name is already English, keeping it as is.
        {
            response.StatusCode = statusCode;
            response.ContentType = contentType;

            byte[] buffer = Encoding.UTF8.GetBytes(payload);
            response.ContentLength64 = buffer.Length;
            
            using (var output = response.OutputStream)
            {
                output.Write(buffer, 0, buffer.Length);
            }
        }

        // ========================================================================= //
        // MAIN THREAD METHODS (UNITY AND YARG NATIVE CODE) //
        // ========================================================================= //

        private void Update() // Method name is already English, keeping it as is.
        {
            // Unity calls this method 60 to 144 times per second.
            // Here we read the queue of safe actions and execute them within the game's permission.
            while (_mainThreadActions.TryDequeue(out var action))
            {
                try
                {
                    action?.Invoke();
                }
                catch (Exception ex)
                {
                    Logger.LogError($"[YARG Remote] Error invoking game action: {ex.Message}");
                }
            }
        }

private void PlaySong(string songId) // Method name is already English, keeping it as is.
{ // 1. Locates the song in SongContainer
    var selectedSong = YARG.Song.SongContainer.Songs.FirstOrDefault(s => 
        s.Hash.ToString() == songId || s.Hash.GetHashCode().ToString() == songId);

    if (selectedSong != null)
    {
        Logger.LogInfo($"[YARG Remote] Play request received for: {selectedSong.Name}");

        _mainThreadActions.Enqueue(() => {
            try 
            {
                // ========================================================== //
                // GLOBAL STATE DEFINITION (What was missing) //
                // ========================================================== //
                
                // Sets the current song for the system
                YARG.GlobalVariables.State.CurrentSong = selectedSong;

                // Clears and adds to the "Show" song list (necessary for menu logic)
                YARG.GlobalVariables.State.ShowSongs.Clear();
                YARG.GlobalVariables.State.ShowSongs.Add(selectedSong);

                // Ensures the game knows it's a single song and not a setlist/show
                YARG.GlobalVariables.State.PlayingAShow = false;

                // ========================================================== //
                // MENU TRANSITION //
                // ========================================================== //

                // Now that the data is in GlobalVariables, the Difficulty menu
                // will know exactly which song to load.
                YARG.Menu.MenuManager.Instance.PushMenu(YARG.Menu.MenuManager.Menu.DifficultySelect);
            }
            catch (Exception ex)
            {
                Logger.LogError($"[YARG Remote] Error configuring song in GlobalState: {ex.Message}");
            }
        });
    }
    else
    {
        Logger.LogWarning($"[YARG Remote] Song with ID {songId} not found.");
    }
}


        private void OnDestroy()
        {
            // Ensures the network port is closed if the game is shut down.
            Logger.LogInfo("[YARG Remote] Shutting down server and releasing port...");
            _isRunning = false;
            _listener?.Stop();
            _listener?.Close();
            
            if (_serverThread != null && _serverThread.IsAlive)
            {
                _serverThread.Join(500); // Waits for the thread to die
            }
        }
        // ========================================== //
        // HELPER FUNCTION: Escape characters for JSON //
        // ========================================== //
        private string EscapeJson(string text) // Method name is already English, keeping it as is.
        {
            if (string.IsNullOrEmpty(text)) return "";

            return text.Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\n", "\\n")
                    .Replace("\r", "\\r")
                    .Replace("\t", "\\t");
        }
    };
}
