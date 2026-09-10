# Spam Call Timewaster

An Android handoff button plus a small voice-bot server. During a suspected spam call, the app calls your bot number. Merge that second call into the original call, mute yourself, and the bot takes over.

## Important limitations

- Android does not allow a normal app to capture or inject audio into a cellular call. The app therefore cannot press **Merge** or **Mute** for you.
- Use this only for calls you have personally answered and reasonably believe are unsolicited. The bot is deliberately prevented from impersonating a real person, requesting sensitive information, making threats, or placing outbound calls.
- The server does not record audio or write transcripts to disk. Twilio and the selected speech/AI providers still process the call. Check the laws that apply where both participants are located before enabling retention or recording.

## Folder layout

- `android/` — minimal Kotlin Android app
- `server/` — Twilio ConversationRelay WebSocket server with OpenAI and canned fallback

## 1. Run the server

Requirements: Node.js 20 or newer, a public HTTPS/WSS host, a Twilio number, and optionally an OpenAI API key.

```bash
cd server
cp .env.example .env
npm install
npm start
```

Set `PUBLIC_BASE_URL` to the public HTTPS address of the server. The health endpoint is `/health`; Twilio's incoming-call webhook is `/voice`; the ConversationRelay socket is `/conversation`.

In Twilio:

1. Accept the Predictive and Generative AI/ML Features Addendum for ConversationRelay.
2. Buy a voice-capable number.
3. Set that number's incoming voice webhook to `https://YOUR-HOST/voice` using HTTP POST.
4. Put the same number in the Android app settings.

`OPENAI_API_KEY` is optional. Without it—or if the AI request fails—the bot cycles through canned delay responses. Set `ALLOWED_CALLER` to your mobile number in E.164 format (for example `+16615551212`) so strangers cannot call and use your bot. Set `TWILIO_AUTH_TOKEN` and keep `VALIDATE_TWILIO=true` in production.

## 2. Build the Android app

Open the `android` directory in Android Studio, allow Gradle to sync, and choose **Build > Build APK(s)**. The project targets Android 16 and runs on Android 8 or newer.

Alternatively, upload the whole project to a private GitHub repository. Open the repository's **Actions** tab, choose **Build Android APK**, select **Run workflow**, and download the `SpamCallTimewaster-debug-apk` artifact when the run completes. Unzip the artifact to obtain `app-debug.apk`.

The first button press asks for phone permission. Enter the Twilio number once in **Bot number**, save it, and use **Test bot call** before relying on it.

## Using it on a Pixel

1. Answer the suspected spam call.
2. Open **Spam Call Timewaster** and press **HAND OFF SPAM CALL**.
3. When the bot answers, tap **Merge** in the Google Phone app.
4. Tap **Mute**. You may hang up your own leg only if your carrier keeps the other two legs connected; most mobile conference calls end when the host leaves, so test this first.

AT&T may charge normal airtime for both call legs. Set `MAX_TURNS` and `MAX_MINUTES` to control cost.

## Bot behavior

The persona is a harmless, confused recipient. It asks for repetition, misunderstands details, gets distracted, and never supplies genuine personal or financial information. It ends immediately if the caller appears to be an emergency service, healthcare provider, school, delivery driver, or another legitimate caller.
