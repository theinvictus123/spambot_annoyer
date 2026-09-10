package com.dustin.spamcalltimewaster

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*

class MainActivity : Activity() {
    private lateinit var number: EditText
    private val prefs by lazy { getSharedPreferences("settings", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(pad, pad * 2, pad, pad)
            setBackgroundColor(Color.rgb(23, 23, 23))
        }
        root.addView(TextView(this).apply {
            text = "SPAM CALL\nTIMEWASTER"
            textSize = 30f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = pad })
        root.addView(TextView(this).apply {
            text = "During a suspected spam call, press the button. When the bot answers, tap MERGE and then MUTE in the Phone app."
            textSize = 17f
            gravity = Gravity.CENTER
            setTextColor(Color.LTGRAY)
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = pad })

        val handoff = Button(this).apply {
            text = "HAND OFF SPAM CALL"
            textSize = 20f
            minHeight = (88 * resources.displayMetrics.density).toInt()
            setOnClickListener { startBotCall() }
        }
        root.addView(handoff, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = pad })

        number = EditText(this).apply {
            hint = "Bot number, e.g. +16615551212"
            inputType = InputType.TYPE_CLASS_PHONE
            setText(prefs.getString("bot_number", ""))
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
        }
        root.addView(number, LinearLayout.LayoutParams(-1, -2))
        root.addView(Button(this).apply {
            text = "Save bot number"
            setOnClickListener {
                prefs.edit().putString("bot_number", number.text.toString().trim()).apply()
                Toast.makeText(this@MainActivity, "Saved", Toast.LENGTH_SHORT).show()
            }
        }, LinearLayout.LayoutParams(-1, -2))
        root.addView(TextView(this).apply {
            text = "Android cannot merge or mute cellular calls automatically. Never use this on emergency, medical, school, delivery, or other legitimate calls."
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.GRAY)
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = pad })
        setContentView(root, ViewGroup.LayoutParams(-1, -1))
    }

    private fun startBotCall() {
        val bot = number.text.toString().trim().replace(Regex("[^+0-9]"), "")
        if (bot.length < 8) {
            Toast.makeText(this, "Enter and save your bot number first", Toast.LENGTH_LONG).show()
            return
        }
        prefs.edit().putString("bot_number", bot).apply()
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CALL_PHONE), 10)
            return
        }
        Toast.makeText(this, "When answered: tap MERGE, then MUTE", Toast.LENGTH_LONG).show()
        startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:$bot")))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 10 && results.firstOrNull() == PackageManager.PERMISSION_GRANTED) startBotCall()
        else if (requestCode == 10) Toast.makeText(this, "Phone permission is required. You can enable it in app settings.", Toast.LENGTH_LONG).show()
    }
}
