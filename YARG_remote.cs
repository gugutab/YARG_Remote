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
using UnityEngine.AddressableAssets;

using YARG.Song;
using YARG.Core.Song;
using YARG.Menu;
using YARG.Core.Utility;
using HarmonyLib;
using TMPro;
using YARG.Menu.Persistent;

namespace YargRemoteMod
{ 
    [BepInPlugin("com.gugutab.yarg.remote", "YARG Remote", "1.1.0")]
    public class YargRemotePlugin : BaseUnityPlugin
    {
        public static YargRemotePlugin Instance { get; private set; }
        public int Port => _portConfig.Value;
        public bool IsServerRunning => _isRunning;
        
        private ConfigEntry<int> _portConfig;
        private HttpListener _listener;
        private Thread _serverThread;
        private bool _isRunning;
        
        // Safe queue to transfer actions from HTTP Server to Unity Main Thread
        private readonly ConcurrentQueue<Action> _mainThreadActions = new ConcurrentQueue<Action>();

        private void Awake()
        {
            Instance = this;

            // Inicializa o Harmony para aplicar os patches
            var harmony = new Harmony("com.gugutab.yarg.remote");
            harmony.PatchAll();

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

        public static string GetLocalIPAddress()
        {
            try
            {
                var host = System.Net.Dns.GetHostEntry(System.Net.Dns.GetHostName());
                
                var addresses = host.AddressList
                    .Where(ip => ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    .Select(ip => ip.ToString())
                    .ToList();

                string preferred = addresses.FirstOrDefault(ip => ip.StartsWith("192.168.0."));
                if (preferred != null) return preferred;

                string fallback = addresses.FirstOrDefault(ip => ip.StartsWith("192.168.") && !ip.StartsWith("192.168.56."));
                if (fallback != null) return fallback;

                return addresses.FirstOrDefault() ?? "127.0.0.1";
            }
            catch 
            {
                return "127.0.0.1";
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

        private void ProcessImageRequest(HttpListenerContext context, string imageType, string idParamName, Func<string, Tuple<byte[], string, int>> imageLoader)
        {
            var request = context.Request;
            var response = context.Response;
            string id = request.QueryString[idParamName];

            if (string.IsNullOrEmpty(id))
            {
                SendResponse(response, 400, $"{{\"status\": \"error\", \"message\": \"Missing parameter ?{idParamName}=id\"}}");
                return;
            }

            using (var mre = new ManualResetEvent(false))
            {
                byte[] imageData = null;
                string contentType = "application/json";
                int statusCode = 500;

                _mainThreadActions.Enqueue(() =>
                {
                    try { var result = imageLoader.Invoke(id); imageData = result.Item1; contentType = result.Item2; statusCode = result.Item3; }
                    catch (Exception ex) { Logger.LogError($"[YARG Remote] Error processing {imageType} request for ID {id}: {ex.Message}"); imageData = Encoding.UTF8.GetBytes($"{{\"status\": \"error\", \"message\": \"Internal Error processing {imageType}\"}}"); contentType = "application/json"; statusCode = 500; }
                    finally { mre.Set(); }
                });

                mre.WaitOne();

                if (imageData != null) { response.ContentType = contentType; response.ContentLength64 = imageData.Length; response.StatusCode = statusCode; using (var outStream = response.OutputStream) { outStream.Write(imageData, 0, imageData.Length); } response.Close(); }
                else { SendResponse(response, 500, "{\"status\": \"error\", \"message\": \"Unexpected error processing image request\"}"); }
            }
        }

        private void ProcessTextRequest(HttpListenerContext context, Func<string> textGenerator)
        {
            var response = context.Response;
            using (var mre = new ManualResetEvent(false))
            {
                string result = null;
                _mainThreadActions.Enqueue(() =>
                {
                    try { result = textGenerator.Invoke(); }
                    catch (Exception ex) { result = $"Error: {ex}"; }
                    finally { mre.Set(); }
                });
                mre.WaitOne();
                SendResponse(response, 200, result ?? "No data", "text/plain");
            }
        }

        private string DebugGetAllSprites()
        {
            var sprites = Resources.FindObjectsOfTypeAll<Sprite>();
            var sb = new StringBuilder();
            sb.AppendLine($"Total Sprites Loaded: {sprites.Length}");
            
            // Filter likely candidates
            var likely = sprites.Where(s => s.name.IndexOf("guitar", StringComparison.OrdinalIgnoreCase) >= 0 || 
                                            s.name.IndexOf("icon", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                            s.name.IndexOf("instrument", StringComparison.OrdinalIgnoreCase) >= 0).ToList();

            sb.AppendLine($"--- Likely Instrument Candidates ({likely.Count}) ---");
            foreach (var s in likely.OrderBy(x => x.name))
            {
                sb.AppendLine(s.name);
            }

            sb.AppendLine("\n--- All Sprites ---");
            foreach (var s in sprites.OrderBy(x => x.name))
            {
                sb.AppendLine(s.name);
            }
            return sb.ToString();
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
                { string songId = request.QueryString["song"]; if (string.IsNullOrEmpty(songId)) { SendResponse(response, 400, "{\"status\": \"error\", \"message\": \"Missing parameter ?song=id\"}"); return; } _mainThreadActions.Enqueue(() => PlaySong(songId)); SendResponse(response, 200, $"{{\"status\": \"ok\", \"message\": \"Song {songId} sent to game queue!\"}}"); }
                else if (path == "/album-art" && request.HttpMethod == "GET")
                {
                    ProcessImageRequest(context, "album art", "song", LoadAlbumArtOnMainThread);
                } else if (path == "/source-icon" && request.HttpMethod == "GET") {
                    ProcessImageRequest(context, "source icon", "source", LoadSourceIconOnMainThread);
                } else if (path == "/instrument-icon" && request.HttpMethod == "GET") {
                    ProcessImageRequest(context, "instrument icon", "name", LoadInstrumentIconOnMainThread);
                }
                else if (path == "/debug-sprites" && request.HttpMethod == "GET") {
                    ProcessTextRequest(context, DebugGetAllSprites);
                }
                else if (path == "/songs" && request.HttpMethod == "GET")
                {
                    var allSongs = SongContainer.Songs; 

                    if (allSongs == null || allSongs.Length == 0) {
                        SendResponse(response, 200, "[]"); 
                        return;
                    }

                    // Manual JSON construction to avoid Newtonsoft.Json dependency
                    var sb = new StringBuilder();
                    sb.Append("[");
                    
                    // We get the count of the original Array
                    int totalCount = allSongs.Length;
                    int limit = Math.Min(totalCount, 5000);

                    var instruments = (YARG.Core.Instrument[])Enum.GetValues(typeof(YARG.Core.Instrument));
                    var difficulties = (YARG.Core.Difficulty[])Enum.GetValues(typeof(YARG.Core.Difficulty));

                    for (int i = 0; i < limit; i++)
                    {
                        if (i > 0) sb.Append(",");

                        var s = allSongs[i];
                        
                        // Build Parts JSON
                        var partsSb = new StringBuilder();
                        partsSb.Append("[");
                        bool firstPart = true;

                        foreach (var inst in instruments)
                        {
                            if (inst == YARG.Core.Instrument.Band) continue;

                            var diffsSb = new StringBuilder();
                            bool firstDiff = true;
                            bool hasDiffs = false;

                            foreach (var diff in difficulties)
                            {
                                if (s.HasDifficultyForInstrument(inst, diff))
                                {
                                    if (!firstDiff) diffsSb.Append(",");
                                    diffsSb.Append($"\"{diff}\"");
                                    firstDiff = false;
                                    hasDiffs = true;
                                }
                            }

                            if (hasDiffs)
                            {
                                if (!firstPart) partsSb.Append(",");
                                partsSb.Append($"{{\"icon\":\"{inst}\",\"difficulties\":[{diffsSb}]}}");
                                firstPart = false;
                            }
                        }
                        partsSb.Append("]");

                        // Build Song JSON
                        sb.Append("{");
                        sb.Append($"\"id\":\"{s.Hash.GetHashCode()}\",");
                        sb.Append($"\"fullHash\":\"{s.Hash}\",");
                        sb.Append($"\"name\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Name))}\",");
                        sb.Append($"\"artist\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Artist))}\",");
                        sb.Append($"\"album\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Album))}\",");
                        sb.Append($"\"genre\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Genre))}\",");
                        sb.Append($"\"charter\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Charter))}\",");
                        sb.Append($"\"sourceIconUrl\":\"http://{GetLocalIPAddress()}:{Port}/source-icon?source={Uri.EscapeDataString(s.Source)}\",");
                        sb.Append($"\"playlist\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Playlist))}\",");
                        sb.Append($"\"source\":\"{EscapeJson(RichTextUtils.StripRichTextTags(s.Source))}\",");
                        sb.Append($"\"isMaster\":{(s.IsMaster ? "true" : "false")},");
                        sb.Append($"\"year\":\"{(s.YearAsNumber == int.MaxValue ? "-" : s.YearAsNumber.ToString())}\",");
                        sb.Append($"\"duration\":\"{(long)(s.SongLengthMilliseconds / 1000 / 60)}:{(long)(s.SongLengthMilliseconds / 1000 % 60):D2}\",");
                        sb.Append($"\"parts\":{partsSb}");
                        sb.Append("}");
                    }
                    sb.Append("]");
                    
                    string json = sb.ToString();

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

        private byte[] EncodeTextureToPNG(Texture2D tex)
        {
            byte[] pngData = null;
            var encodeMethod = typeof(Texture2D).GetMethod("EncodeToPNG");
            if (encodeMethod != null)
            {
                pngData = (byte[])encodeMethod.Invoke(tex, null);
            }
            else
            {
                var imgConv = Type.GetType("UnityEngine.ImageConversion, UnityEngine.ImageConversionModule");
                if (imgConv != null)
                {
                    var m = imgConv.GetMethod("EncodeToPNG", new[] { typeof(Texture2D) });
                    if (m != null) pngData = (byte[])m.Invoke(null, new object[] { tex });
                }
            }
            return pngData;
        }

        private Tuple<byte[], string, int> LoadAlbumArtOnMainThread(string songId)
        {
            var song = SongContainer.Songs.FirstOrDefault(s => s.Hash.ToString() == songId || s.Hash.GetHashCode().ToString() == songId);
            if (song == null)
            {
                return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Song not found\"}"), "application/json", 404);
            }

            unsafe
            {
                using (var img = song.LoadAlbumData())
                {
                    if (img == null || img.Data == null)
                    {
                        return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"No album art found\"}"), "application/json", 404);
                    }

                    TextureFormat tf = TextureFormat.RGBA32;
                    if ((int)img.Format == 3) tf = TextureFormat.RGB24;

                    Texture2D tex = new Texture2D(img.Width, img.Height, tf, false);
                    tex.LoadRawTextureData((IntPtr)img.Data, img.Width * img.Height * ((int)img.Format));
                    tex.Apply();

                    var pixels = tex.GetPixels32();
                    int w = tex.width;
                    int h = tex.height;
                    var newPixels = new Color32[pixels.Length];
                    for (int y = 0; y < h; y++) Array.Copy(pixels, y * w, newPixels, (h - y - 1) * w, w);
                    tex.SetPixels32(newPixels);
                    tex.Apply();

                    byte[] pngData = EncodeTextureToPNG(tex);
                    Destroy(tex);

                    if (pngData != null) { return Tuple.Create(pngData, "image/png", 200); }
                    else { Logger.LogError("[YARG Remote] EncodeToPNG failed for album art."); return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Encoding Error for album art\"}"), "application/json", 500); }
                }
            }
        }

        private Tuple<byte[], string, int> LoadInstrumentIconOnMainThread(string instrumentName)
        {
            Logger.LogInfo($"[YARG Remote] Loading icon for: {instrumentName}");
            try
            {
                if (Enum.TryParse(instrumentName, true, out YARG.Core.Instrument inst))
                {
                    Type providerType = Type.GetType("YARG.Gameplay.HUD.InstrumentIconProvider, Assembly-CSharp");
                    if (providerType == null)
                        providerType = AppDomain.CurrentDomain.GetAssemblies().SelectMany(a => { try { return a.GetTypes(); } catch { return new Type[0]; } }).FirstOrDefault(t => t.FullName == "YARG.Gameplay.HUD.InstrumentIconProvider");

                    string resourceKey = null;

                    if (providerType != null)
                    {
                        // Get resource name using private static GetInstrumentSprite method
                        var getSpriteMethod = providerType.GetMethod("GetInstrumentSprite", 
                            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static, 
                            null, 
                            new[] { typeof(YARG.Core.Instrument), typeof(int), typeof(bool) }, 
                            null);

                        if (getSpriteMethod != null)
                        {
                            try {
                                resourceKey = (string)getSpriteMethod.Invoke(null, new object[] { inst, 0, false });
                                Logger.LogInfo($"[YARG Remote] Resource key for {inst}: {resourceKey}");

                                // Now load the sprite using Addressables (as shown in PlayerNameDisplay.cs)
                                if (!string.IsNullOrEmpty(resourceKey))
                                {
                                    try
                                    {
                                        Sprite sprite = Addressables.LoadAssetAsync<Sprite>(resourceKey).WaitForCompletion();
                                        
                                        if (sprite != null)
                                        {
                                            Logger.LogInfo($"[YARG Remote] Successfully loaded sprite via Addressables for {resourceKey}");
                                            byte[] pngData = GetPngFromSprite(sprite, flipVertically: false);
                                            if (pngData != null) return Tuple.Create(pngData, "image/png", 200);
                                        }
                                        else
                                        {
                                            Logger.LogError($"[YARG Remote] Addressables returned null sprite for {resourceKey}");
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        Logger.LogError($"[YARG Remote] Error loading sprite via Addressables for {resourceKey}: {ex.Message}");
                                    }
                                }
                            } catch (Exception ex) { Logger.LogError($"[YARG Remote] Error invoking GetInstrumentSprite: {ex.Message}"); }
                        }
                        else
                        {
                            Logger.LogError($"[YARG Remote] GetInstrumentSprite method not found");
                        }
                    }
                    else
                    {
                        Logger.LogError($"[YARG Remote] InstrumentIconProvider type not found");
                    }
                }
                else
                {
                    Logger.LogError($"[YARG Remote] Could not parse instrument name: {instrumentName}");
                }
            }
            catch (Exception ex)
            {
                Logger.LogError($"[YARG Remote] Error loading instrument icon: {ex}");
            }
            return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Instrument icon not found\"}"), "application/json", 404);
        }

        private byte[] GetPngFromSprite(Sprite sprite, bool flipVertically = false)
        {
            if (sprite == null || sprite.texture == null) return null;

            Texture2D originalTexture = sprite.texture;
            var uvs = sprite.uv;
            float minX = 1f, maxX = 0f, minY = 1f, maxY = 0f;

            if (uvs != null && uvs.Length > 0)
            {
                minX = uvs[0].x; maxX = uvs[0].x;
                minY = uvs[0].y; maxY = uvs[0].y;
                foreach (var uv in uvs)
                {
                    if (uv.x < minX) minX = uv.x;
                    if (uv.x > maxX) maxX = uv.x;
                    if (uv.y < minY) minY = uv.y;
                    if (uv.y > maxY) maxY = uv.y;
                }
            }
            else { minX = 0; maxX = 1; minY = 0; maxY = 1; }

            int texW = originalTexture.width;
            int texH = originalTexture.height;
            int x = Mathf.RoundToInt(minX * texW);
            int y = Mathf.RoundToInt(minY * texH);
            int width = Mathf.RoundToInt((maxX - minX) * texW);
            int height = Mathf.RoundToInt((maxY - minY) * texH);

            if (width <= 0) width = 1;
            if (height <= 0) height = 1;
            x = Mathf.Clamp(x, 0, texW - 1);
            y = Mathf.Clamp(y, 0, texH - 1);
            if (x + width > texW) width = texW - x;
            if (y + height > texH) height = texH - y;

            Rect rect = new Rect(x, y, width, height);
            Texture2D tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
            
            RenderTexture currentRT = RenderTexture.active;
            RenderTexture renderTex = RenderTexture.GetTemporary(originalTexture.width, originalTexture.height, 0, RenderTextureFormat.Default, RenderTextureReadWrite.Linear);
            Graphics.Blit(originalTexture, renderTex);
            RenderTexture.active = renderTex;
            tex.ReadPixels(rect, 0, 0);
            tex.Apply();
            RenderTexture.active = currentRT;
            RenderTexture.ReleaseTemporary(renderTex);

            var pixels = tex.GetPixels32();
            if (flipVertically)
            {
                var newPixels = new Color32[pixels.Length];
                for (int r = 0; r < height; r++) Array.Copy(pixels, r * width, newPixels, (height - r - 1) * width, width);
                tex.SetPixels32(newPixels);
                tex.Apply();
            }

            byte[] pngData = EncodeTextureToPNG(tex);
            Destroy(tex);
            return pngData;
        }

        private Tuple<byte[], string, int> LoadSourceIconOnMainThread(string sourceName)
        {
            var songSourcesType = typeof(YARG.Song.SongSources);
            var sourceToIconMethod = songSourcesType.GetMethod("SourceToIcon", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);

            if (sourceToIconMethod == null) { Logger.LogError("[YARG Remote] YARG.Song.SongSources.SourceToIcon method not found via reflection."); return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Internal mod error: SourceToIcon method not found\"}"), "application/json", 500); }

            Sprite sprite = (Sprite)sourceToIconMethod.Invoke(null, new object[] { sourceName });

            if (sprite == null) { return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Source icon not found for " + sourceName + "\"}"), "application/json", 404); }

            if (sprite.texture == null)
            {
                Logger.LogError($"[YARG Remote] Sprite texture is null for source: {sourceName}");
                return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Source icon texture is null\"}"), "application/json", 404);
            }

            byte[] pngData = GetPngFromSprite(sprite, flipVertically: true);

            if (pngData != null) { return Tuple.Create(pngData, "image/png", 200); }
            else { Logger.LogError("[YARG Remote] EncodeToPNG failed for source icon."); return Tuple.Create(Encoding.UTF8.GetBytes("{\"status\": \"error\", \"message\": \"Encoding Error for source icon\"}"), "application/json", 500); }
        }

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


[HarmonyPatch(typeof(YARG.Menu.Persistent.DevWatermark), "Start")]
    public static class DevWatermark_Start_Patch
    {
        // Usamos Prefix retornando false para cancelar a execução do Start() original
        // O campo _watermarkText ganha 3 underlines a mais (____watermarkText) por exigência do Harmony
        public static bool Prefix(YARG.Menu.Persistent.DevWatermark __instance, ref TextMeshProUGUI ____watermarkText)
        {
            // 1. Força a ativação para que apareça em builds de release/estáveis
            __instance.gameObject.SetActive(true);

            // 2. Reconstrói o texto de versão seguindo a lógica original do jogo
            string version = YARG.GlobalVariables.Instance.CurrentVersion;
            string graphics = SystemInfo.graphicsDeviceType.ToString();
            string buildType = "Development Build"; // Padrão para mods

            if (Application.isEditor) {
                buildType = "Unity Editor";
            } else if (version.Contains("nightly")) {
                buildType = "Nightly Build";
            }

            string versionLine = $"<b>YARG {version}</b> {buildType} ({graphics})";

            // 3. WebServer Data
            int port = YargRemotePlugin.Instance.Port; string status = YargRemotePlugin.Instance.IsServerRunning ? "<color=green>Online</color>" : "<color=red>Offline</color>"; string ip = YargRemotePlugin.GetLocalIPAddress();
            // 4. Combine lines (Second line 50% size)
            ____watermarkText.text = $"<size=80%>{versionLine}</size>\n<size=60%>Remote [{status}]: http://{ip}:{port}/</size>"; return false;
        }
    }
    
}
