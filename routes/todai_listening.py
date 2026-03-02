import os
import io
from flask import Blueprint, render_template, request, send_file
from pydub import AudioSegment, effects
from pydub.generators import WhiteNoise

# --- Render.com対策: ffmpegへのパスを通す ---
# 現在のディレクトリ(ffmpegがある場所)をPATHに追加
os.environ["PATH"] += os.pathsep + os.getcwd()

todai_bp = Blueprint('todai_listening', __name__, url_prefix='/todai')

def change_audiosegment_speed(seg, speed):
    if speed == 1.0:
        return seg
    return effects.speedup(seg, playback_speed=speed)

def apply_classroom_effect(seg):
    # 帯域制限 (300Hz - 3000Hz)
    seg = seg.high_pass_filter(300).low_pass_filter(3000)
    # ノイズ生成
    noise = WhiteNoise().to_audio_segment(duration=len(seg), volume=-30.0)
    return seg.overlay(noise)

@todai_bp.route('/', methods=['GET', 'POST'])
def generate_audio():
    if request.method == 'GET':
        return render_template('todai_generator.html')

    try:
        file_a = request.files.get('file_a')
        file_b = request.files.get('file_b')
        file_c = request.files.get('file_c')

        if not (file_a and file_b and file_c):
            return "全てのファイルをアップロードしてください。", 400

        speed_a = float(request.form.get('speed_a', 1.0))
        speed_b = float(request.form.get('speed_b', 1.0))
        speed_c = float(request.form.get('speed_c', 1.0))
        bad_quality = 'bad_quality' in request.form

        sound_a = AudioSegment.from_file(file_a)
        sound_b = AudioSegment.from_file(file_b)
        sound_c = AudioSegment.from_file(file_c)

        sound_a = change_audiosegment_speed(sound_a, speed_a)
        sound_b = change_audiosegment_speed(sound_b, speed_b)
        sound_c = change_audiosegment_speed(sound_c, speed_c)

        pause_30s = AudioSegment.silent(duration=30 * 1000)
        pause_60s = AudioSegment.silent(duration=60 * 1000)

        full_track = (
            sound_a + pause_30s + sound_a + pause_60s +
            sound_b + pause_30s + sound_b + pause_60s +
            sound_c + pause_30s + sound_c
        )

        if bad_quality:
            full_track = apply_classroom_effect(full_track)

        output_io = io.BytesIO()
        full_track.export(output_io, format="mp3", bitrate="128k")
        output_io.seek(0)

        return send_file(
            output_io,
            mimetype="audio/mpeg",
            as_attachment=True,
            download_name="todai_simulation.mp3"
        )

    except Exception as e:
        return f"エラーが発生しました: {str(e)}<br>ffmpegのインストールを確認してください。", 500
