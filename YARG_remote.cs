using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Threading;
using System.Linq;
using BepInEx;
using BepInEx.Configuration;
using UnityEngine;

using Newtonsoft.Json;
using YARG.Song;
using YARG.Core.Song;
using YARG.Menu;
using YARG.Core.Utility;


namespace YargRemoteMod
{ 
    [BepInPlugin("com.gugutab.yarg.remote", "YARG Remote", "1.1.0")]
    public class YargRemotePlugin : BaseUnityPlugin
    {
        private ConfigEntry<int> _portConfig;
        private HttpListener _listener;
        private Thread _serverThread;
        private bool _isRunning;
        
        // Safe queue to transfer actions from HTTP Server to Unity Main Thread
        private readonly ConcurrentQueue<Action> _mainThreadActions = new ConcurrentQueue<Action>();

        private void Awake()
        {
            Logger.LogInfo("=======================================");
            Logger.LogInfo("YARG Remote Server Starting...");
            Logger.LogInfo("=======================================");
            
            // Port configuration (allows user to change in BepInEx config file)
            _portConfig = Config.Bind("Server", "Port", 8888, "TCP port for the YARG Remote web server.");

            // Starts the server on the configured port
            StartServer(_portConfig.Value); 
        }

        private void StartServer(int port)
        {
            try
            {
                _listener = new HttpListener();
                // The "+" prefix allows connections from any IP on your LAN
                _listener.Prefixes.Add($"http://+:{port}/"); 
                _listener.Start();
                _isRunning = true;

                // Starts the server in a separate Thread to avoid freezing the game
                _serverThread = new Thread(ServerLoop)
                {
                    IsBackground = true,
                    Name = "YargRemoteServerThread"
                };
                _serverThread.Start();

                Logger.LogInfo($"[YARG Remote] Listening for commands on network at http://localhost:{port}/");
            }
            catch (Exception ex)
            {
                Logger.LogError($"[YARG Remote] Critical error starting port {port}: {ex.Message}");
                Logger.LogError("TIP: Run the game as Administrator if the port is being denied by Windows.");
            }
        }

        private void ServerLoop()
        {
            while (_isRunning && _listener.IsListening)
            {
                try
                {
                    // Pauses the thread until an HTTP request is received
                    var context = _listener.GetContext();
                    ProcessRequest(context);
                }
                catch (HttpListenerException)
                {
                    // Normal exception thrown when we force _listener to stop in OnDestroy()
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
                else if (path == "/album-art" && request.HttpMethod == "GET")
                {
                    string songId = request.QueryString["song"];
                    if (string.IsNullOrEmpty(songId)) { SendResponse(response, 400, "Missing song id"); return; }

                    // Enqueue to main thread because we need to use Unity's Texture2D and YARG's loaders safely
                    _mainThreadActions.Enqueue(() => {
                        try {
                            var song = SongContainer.Songs.FirstOrDefault(s => s.Hash.ToString() == songId || s.Hash.GetHashCode().ToString() == songId);
                            if (song == null) {
                                SendResponse(response, 404, "Song not found");
                                return;
                            }

                            // Use unsafe block for pointer operations
                            unsafe {
                                using (var img = song.LoadAlbumData())
                                {
                                    if (img == null || img.Data == null) {
                                        SendResponse(response, 404, "No art");
                                        return;
                                    }

                                    // Determine format (assuming 3=RGB, 4=RGBA based on stb_image standard)
                                    TextureFormat tf = TextureFormat.RGBA32;
                                    if ((int)img.Format == 3) tf = TextureFormat.RGB24;

                                    // Create temporary texture to convert raw bytes to PNG
                                    Texture2D tex = new Texture2D(img.Width, img.Height, tf, false);
                                    tex.LoadRawTextureData((IntPtr)img.Data, img.Width * img.Height * ((int)img.Format));
                                    tex.Apply();

                                    // Fix upside down image (Flip Y only)
                                    var pixels = tex.GetPixels32();
                                    int w = tex.width;
                                    int h = tex.height;
                                    var newPixels = new Color32[pixels.Length];
                                    for (int y = 0; y < h; y++) Array.Copy(pixels, y * w, newPixels, (h - y - 1) * w, w);
                                    tex.SetPixels32(newPixels);
                                    tex.Apply();

                                    // Encode to PNG using reflection to avoid missing assembly reference issues
                                    byte[] pngData = null;
                                    var encodeMethod = typeof(Texture2D).GetMethod("EncodeToPNG");
                                    if (encodeMethod != null) {
                                        pngData = (byte[])encodeMethod.Invoke(tex, null);
                                    } else {
                                        // Fallback for newer Unity versions or if extension method is hidden
                                        var imgConv = Type.GetType("UnityEngine.ImageConversion, UnityEngine.ImageConversionModule");
                                        if (imgConv != null) {
                                            var m = imgConv.GetMethod("EncodeToPNG", new[] { typeof(Texture2D) });
                                            if (m != null) pngData = (byte[])m.Invoke(null, new object[] { tex });
                                        }
                                    }

                                    Destroy(tex); // Cleanup Unity texture

                                    if (pngData != null) {
                                        response.ContentType = "image/png";
                                        response.ContentLength64 = pngData.Length;
                                        response.StatusCode = 200;
                                        using (var outStream = response.OutputStream) {
                                            outStream.Write(pngData, 0, pngData.Length);
                                        }
                                        response.Close();
                                    } else {
                                        Logger.LogError("[YARG Remote] EncodeToPNG method not found via reflection.");
                                        SendResponse(response, 500, "Encoding Error");
                                    }
                                }
                            }
                        } catch (Exception ex) {
                            Logger.LogError($"[YARG Remote] Error fetching art: {ex.Message}");
                            SendResponse(response, 500, "Internal Error");
                        }
                    });
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
            {
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
