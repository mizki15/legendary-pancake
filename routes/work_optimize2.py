from flask import Blueprint, request, send_file, render_template
        print(k, '=>', v)
    print('--- form end ---')

    # textarea の便番号を行ごとに分割
    flight_number_raw = request.form.get("flight_number", "")
    flight_numbers = [f.strip() for f in flight_number_raw.splitlines() if f.strip()]
    if not flight_numbers:
        # 空でも1行の空文字列を出力する（必要に応じて変更）
        flight_numbers = [""]

    # 他の単純フィールド
    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")

    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    # 利益率グループを取得するヘルパー
    def get_group(prefix):
        # checkbox はチェック時に '1' が送られる想定
        allweek = request.form.get(f"{prefix}_allweek")
        keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
        vals = []
        for k in keys:
            v = request.form.get(f"{prefix}_{k}", "0")
            v = v.strip() if isinstance(v, str) else v
            if v == "":
                v = "0"
            vals.append(v)
        if allweek:
            # 全曜日適用なら日曜日の値を使う
            return [vals[0]] * 7
        return vals

    adult_profits = get_group("adult")
    child_profits = get_group("child")
    infant_profits = get_group("infant")

    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    # 作成日時 (JST)
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    # CSV 生成: 各便×各曜日 の行を出力
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # ヘッダ（必要なら）
    writer.writerow(["flight_number", "route", "sale_from", "sale_to", "flight_from", "flight_to", "day", "airport", "participants", "generated_at", "weekday", "adult_profit", "child_profit", "infant_profit"]) 

    for flight in flight_numbers:
        for idx, youbi in enumerate(youbi_list):
            writer.writerow([
                flight,
                route,
                sale_from,
                sale_to,
                flight_from,
                flight_to,
                day,
                airport,
                participants_disp,
                now_str,
                youbi,
                adult_profits[idx],
                child_profits[idx],
                infant_profits[idx],
            ])

    output.seek(0)

    return send_file(
        io.BytesIO(output.getvalue().encode("shift_jis", errors="replace")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )
