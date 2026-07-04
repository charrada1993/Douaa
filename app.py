import os
import json
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import firebase_admin
from firebase_admin import credentials, db
from dotenv import load_dotenv

# Load local environment variables if present
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "fallback_cute_secret_key_98765")
APP_PASSCODE = os.environ.get("APP_PASSCODE", "1234")

# Initialize Firebase Admin SDK
firebase_creds_env = os.environ.get("FIREBASE_CREDENTIALS_JSON")
db_url = os.environ.get("FIREBASE_DB_URL")

if not firebase_creds_env:
    print("WARNING: FIREBASE_CREDENTIALS_JSON is not set. App might fail on Firebase DB actions.")
if not db_url:
    print("WARNING: FIREBASE_DB_URL is not set. App might fail on Firebase DB actions.")

import re

firebase_initialized = False
if firebase_creds_env and db_url:
    try:
        # Check if the env var contains a JSON string
        if firebase_creds_env.strip().startswith("{"):
            # ── Step 1: try to parse as-is ──────────────────────────────────
            try:
                creds_dict = json.loads(firebase_creds_env)
            except Exception:
                # ── Step 2: the private_key may contain raw newlines (not \n)
                # which makes the JSON invalid.  Replace them only *inside*
                # the private_key value, then try again.
                def _fix_private_key_newlines(raw: str) -> str:
                    """
                    Replace raw (unescaped) newlines that appear inside the
                    private_key string value with the JSON escape sequence \\n.
                    """
                    # Find the private_key value between its surrounding quotes
                    m = re.search(r'"private_key"\s*:\s*"([\s\S]*?)",\s*"client_email"', raw)
                    if m:
                        original_val = m.group(1)
                        # Replace literal newlines with \n (JSON-safe)
                        fixed_val = original_val.replace('\n', '\\n').replace('\r', '')
                        raw = raw[:m.start(1)] + fixed_val + raw[m.end(1):]
                    return raw

                try:
                    fixed = _fix_private_key_newlines(firebase_creds_env)
                    creds_dict = json.loads(fixed)
                except Exception:
                    # ── Step 3: strip ALL literal newlines from the whole
                    # string (they should all be \n-encoded in valid JSON)
                    cleaned = firebase_creds_env.replace('\r\n', '\\n') \
                                                .replace('\r', '\\n') \
                                                .replace('\n', '\\n')
                    creds_dict = json.loads(cleaned)

            # ── After parsing: ensure private_key has real newlines ─────────
            # json.loads should give us real \n chars, but some envs deliver
            # the literal two-char sequence  \  n  instead.
            pk = creds_dict.get("private_key", "")
            pk = pk.replace("\\n", "\n").replace("\\\\n", "\n")
            creds_dict["private_key"] = pk

            cred = credentials.Certificate(creds_dict)
        else:
            # Otherwise treat as a path to the credentials JSON file
            if not os.path.isabs(firebase_creds_env):
                base_dir = os.path.dirname(os.path.abspath(__file__))
                firebase_creds_env = os.path.join(base_dir, firebase_creds_env)
            cred = credentials.Certificate(firebase_creds_env)

        firebase_admin.initialize_app(cred, {
            'databaseURL': db_url
        })
        firebase_initialized = True
        print("Firebase Admin SDK successfully initialized.")
    except Exception as e:
        print(f"ERROR: Failed to initialize Firebase Admin SDK: {e}")


# Helper to verify session login
def is_logged_in():
    return session.get("authenticated") is True

# Serve Service Worker from root so it controls the full "/" scope
@app.route("/sw.js")
def service_worker():
    from flask import send_from_directory
    response = send_from_directory("static", "sw.js", mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response

# Serve manifest from root (some browsers require this)
@app.route("/manifest.json")
def manifest():
    from flask import send_from_directory
    return send_from_directory("static", "manifest.json", mimetype="application/manifest+json")

# Smart download route — detects device and serves the right file
@app.route("/download")
def download_app():
    from flask import send_from_directory, Response
    user_agent = request.headers.get("User-Agent", "").lower()

    if "windows" in user_agent:
        # Serve Windows internet shortcut (.url file)
        return send_from_directory(
            "static/download",
            "YourCycleMagic.url",
            as_attachment=True,
            download_name="YourCycleMagic.url",
            mimetype="application/octet-stream"
        )
    elif "android" in user_agent:
        # Redirect to PWABuilder-generated APK download page
        return redirect("https://www.pwabuilder.com/reportcard?site=https://douaa.onrender.com", 302)
    elif "iphone" in user_agent or "ipad" in user_agent or "mac os" in user_agent:
        # iOS/macOS — no direct download possible
        return Response(
            "<script>window.history.back();</script>"
            "<meta charset='utf-8'><p>On iPhone: Open in Safari → tap Share → Add to Home Screen 🌸</p>",
            mimetype="text/html"
        )
    else:
        # Fallback — serve the Windows shortcut
        return send_from_directory(
            "static/download",
            "YourCycleMagic.url",
            as_attachment=True,
            download_name="YourCycleMagic.url",
            mimetype="application/octet-stream"
        )

@app.route("/")
def index():
    if not is_logged_in():
        return redirect(url_for("login_page"))
    return render_template("index.html")

@app.route("/login", methods=["GET", "POST"])
def login_page():
    if is_logged_in():
        return redirect(url_for("index"))
    
    if request.method == "POST":
        # Handle form submission or API check
        data = request.get_json() or request.form
        passcode = data.get("passcode")
        if passcode == APP_PASSCODE:
            session["authenticated"] = True
            session.permanent = True
            return jsonify({"success": True})
        else:
            return jsonify({"success": False, "message": "Incorrect passcode, sweetie! 💕"}), 401
            
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.pop("authenticated", None)
    return redirect(url_for("login_page"))

# API endpoint to log a period
@app.route("/api/log_period", methods=["POST"])
def log_period():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
        
    if not firebase_initialized:
        return jsonify({"error": "Firebase is not configured properly."}), 500
        
    try:
        data = request.get_json()
        start_date = data.get("start_date")
        end_date = data.get("end_date") or None
        notes = data.get("notes", "")
        mood = data.get("mood", "")
        symptoms = data.get("symptoms", [])
        
        if not start_date:
            return jsonify({"error": "Start date is required."}), 400
            
        # Push to firebase under /periods
        ref = db.reference("periods")
        new_entry_ref = ref.push()
        new_entry_ref.set({
            "start_date": start_date,
            "end_date": end_date,
            "notes": notes,
            "mood": mood,
            "symptoms": symptoms,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        return jsonify({"success": True, "id": new_entry_ref.key})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# API endpoint to delete a period entry
@app.route("/api/delete_period/<entry_id>", methods=["DELETE"])
def delete_period(entry_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
        
    if not firebase_initialized:
        return jsonify({"error": "Firebase is not configured."}), 500
        
    try:
        ref = db.reference(f"periods/{entry_id}")
        ref.delete()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# API endpoint to get log history and prediction statistics
@app.route("/api/get_history", methods=["GET"])
def get_history():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
        
    if not firebase_initialized:
        # For demonstration or local fallback in case Firebase is not connected
        return jsonify({
            "periods": [],
            "stats": {
                "average_cycle_length": 28,
                "next_period_prediction": None,
                "days_until": None,
                "fertile_start": None,
                "fertile_end": None,
                "ovulation_date": None
            },
            "error_msg": "Firebase not initialized"
        })
        
    try:
        ref = db.reference("periods")
        periods_data = ref.get()
        
        periods_list = []
        if periods_data:
            for key, val in periods_data.items():
                val["id"] = key
                periods_list.append(val)
                
        # Sort periods by start_date ascending
        periods_list.sort(key=lambda x: x["start_date"])
        
        # Calculate cycle lengths
        # Cycle length is computed as start_date of period N+1 minus start_date of period N
        cycle_lengths = []
        for i in range(len(periods_list) - 1):
            d1 = datetime.strptime(periods_list[i]["start_date"], "%Y-%m-%d")
            d2 = datetime.strptime(periods_list[i + 1]["start_date"], "%Y-%m-%d")
            diff = (d2 - d1).days
            # Filter typical valid cycle lengths (e.g. 15 to 45 days) to avoid calculating based on double entries
            if 15 <= diff <= 45:
                cycle_lengths.append(diff)
                periods_list[i]["cycle_length"] = diff
            else:
                periods_list[i]["cycle_length"] = None
        
        if periods_list:
            periods_list[-1]["cycle_length"] = None  # Last one has no successor yet
            
        # Determine average cycle length (use last 3 to 6 cycles if available)
        recent_cycle_lengths = cycle_lengths[-6:] if len(cycle_lengths) >= 6 else cycle_lengths
        avg_cycle = int(round(sum(recent_cycle_lengths) / len(recent_cycle_lengths))) if recent_cycle_lengths else 28
        
        # Calculate Predictions based on the last logged period
        next_prediction = None
        days_until = None
        fertile_start = None
        fertile_end = None
        ovulation_date = None
        
        if periods_list:
            last_period = periods_list[-1]
            last_start = datetime.strptime(last_period["start_date"], "%Y-%m-%d")
            
            # Predict next period start
            predicted_date = last_start + timedelta(days=avg_cycle)
            next_prediction = predicted_date.strftime("%Y-%m-%d")
            
            today = datetime.now().date()
            days_until = (predicted_date.date() - today).days
            
            # Calculate ovulation and fertile window
            # Ovulation typically occurs 14 days before the next period starts
            ovulation = predicted_date - timedelta(days=14)
            ovulation_date = ovulation.strftime("%Y-%m-%d")
            
            # Fertile window is typically 5 days before ovulation plus the day of ovulation
            fertile_start = (ovulation - timedelta(days=5)).strftime("%Y-%m-%d")
            fertile_end = (ovulation + timedelta(days=1)).strftime("%Y-%m-%d")
            
        # Reverse periods list so they display descending (newest first)
        periods_list.reverse()
        
        stats = {
            "average_cycle_length": avg_cycle,
            "next_period_prediction": next_prediction,
            "days_until": days_until,
            "fertile_start": fertile_start,
            "fertile_end": fertile_end,
            "ovulation_date": ovulation_date
        }
        
        return jsonify({
            "periods": periods_list,
            "stats": stats
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Ensure templates/static directories exist
    os.makedirs("templates", exist_ok=True)
    os.makedirs("static/css", exist_ok=True)
    os.makedirs("static/js", exist_ok=True)
    os.makedirs("static/images", exist_ok=True)
    
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
