import csv
import io
import unittest

from app import app
from apps.study.routes import fetch_words
from apps.ut_eitan_quiz import ut_eitan_quiz
from portfolio.projects import PROJECTS


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_existing_pages_and_assets(self):
        paths = [
            "/", "/study", "/opt1/work_optimize1", "/opt2/work_optimize2",
            "/rocket", "/rocket_orbit", "/rocket_mobile",
            "/rocket_mobile_orbit", "/txtstore", "/keiba",
            "/mainkurafuto", "/pingpong",
            *[f"/ut-eitan-quiz{suffix}/" for suffix in ("", "-1", "-2", "-3", "-4", "-5", "-6")],
        ]
        for path in paths:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.data)

        for path in (
            "/static/css/index_style.css", "/static/words.csv",
            "/static/sentences.csv", "/opt1/static/css/work_optimization_style.css",
            "/opt2/static/css/work_optimization_style2.css",
            "/static/css/work_optimization_style.css",
            "/static/css/work_optimization_style2.css",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_hiding_card_preserves_direct_url(self):
        project = next(item for item in PROJECTS if item["id"] == "rocket")
        old_value = project["visible"]
        try:
            project["visible"] = False
            home = self.client.get("/").get_data(as_text=True)
            self.assertNotIn('href="/rocket_orbit"', home)
            self.assertNotIn('href="/rocket_mobile_orbit"', home)
            self.assertIn('href="/opt2/work_optimize2"', home)
            self.assertEqual(self.client.get("/rocket_orbit").status_code, 200)
            self.assertEqual(self.client.get("/rocket_mobile_orbit").status_code, 200)
        finally:
            project["visible"] = old_value

    def test_local_data_and_csv_conversion(self):
        self.assertGreater(len(fetch_words()), 0)
        response = self.client.post("/opt2/convert", data={
            "flight_number": "NH001", "routes": "TYO-OSA",
            "profit_adult_allweek": "1", "profit_adult": "10",
        })
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.data.decode("shift_jis"))))
        self.assertEqual(len(rows), 7)
        self.assertEqual([row[10] for row in rows], ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"])
        self.assertTrue(all(row[0] == "NH001" for row in rows))

    def test_quiz_answer_endpoint(self):
        sentences, words = ut_eitan_quiz.load_data()
        self.assertGreater(len(sentences), 5)  # The bundled data loaded, not demo fallback.
        self.assertTrue(words)
        self.assertEqual(self.client.get("/ut-eitan-quiz/?q=0").status_code, 200)
        response = self.client.post("/ut-eitan-quiz/check", json={"answers": []})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["is_all_correct"])
        self.assertTrue(response.json["results"])


if __name__ == "__main__":
    unittest.main()
