"""Portfolio cards. Set visible to False to hide an app from the home page.

The app's routes stay available when its cards are hidden. Add a new app here
after registering its Blueprint in app.py.
"""

PROJECTS = [
    {
        "id": "work_optimize1",
        "visible": True,
        "cards": [{
            "endpoint": "work_optimize1.index",
            "title": "業務効率化ツール",
            "description": "csvを出力",
            "image": "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgbBbt71YAW-O-64X4vfSaHjU6fGqvqU9mIJKQd_5zBOCN3kSP0um96TmvNsAWyiXG7NAPKoySBJoqPbKijnyluKR-8qhQgC7M1ipkF2i5f6BUCroArZ-nSd7GydlaVYIzmPKXBzmY1DRU/s400/dentaku_syoumen_small.png",
        }],
    },
    {
        "id": "work_optimize2",
        "visible": True,
        "cards": [{
            "endpoint": "work_optimize2.index",
            "title": "業務効率化ツール2(フライト)",
            "description": "csvを出力",
            "image": "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgbBbt71YAW-O-64X4vfSaHjU6fGqvqU9mIJKQd_5zBOCN3kSP0um96TmvNsAWyiXG7NAPKoySBJoqPbKijnyluKR-8qhQgC7M1ipkF2i5f6BUCroArZ-nSd7GydlaVYIzmPKXBzmY1DRU/s400/dentaku_syoumen_small.png",
        }],
    },
    {
        "id": "rocket",
        "visible": True,
        "cards": [
            {
                "endpoint": "rocket.rocket_orbit",
                "title": "月面着陸🚀",
                "description": "PC版",
                "image": "https://em-content.zobj.net/source/microsoft-teams/364/rocket_1f680.png",
            },
            {
                "endpoint": "rocket.rocket_mobile_orbit",
                "title": "月面着陸🚀",
                "description": "スマホ版",
                "image": "https://em-content.zobj.net/source/microsoft-teams/364/rocket_1f680.png",
            },
        ],
    },
    {
        "id": "txtstore",
        "visible": True,
        "cards": [{
            "endpoint": "txtstore.txtstore",
            "title": "インスタントテキスト保存",
            "description": "早い",
            "image": "https://thumb.ac-illust.com/08/081edf135a843503d5cf31957f950375_t.jpeg",
        }],
    },
    {
        "id": "keiba",
        "visible": True,
        "cards": [{
            "endpoint": "keiba.keiba",
            "title": "競馬(弟作)",
            "description": "ギャンブル",
            "image": "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEj8MkeAqF49O1g2y3v1yeZcsNLlzHgjzPtngjNQ2JiQ0mKGt8bsYmcDMMxcTFQO5aFw0_OXS2ge5vt3Zx5TuwaMnwNPlH8xolO50xDcTzXkoqDFVKd1jPtowNGn0VMs74yiGsJl76QVTIG8/s800/keiba_jockey7_orange.png",
        }],
    },
    {
        "id": "mainkurafuto",
        "visible": True,
        "cards": [{
            "endpoint": "mainkurafuto.mainkurafuto",
            "title": "偽マインクラフト",
            "description": "偽物",
            "image": "https://minecraft.wiki/images/thumb/Desert_Grass_Block.png/150px-Desert_Grass_Block.png?eb2cb",
        }],
    },
    {
        "id": "study",
        "visible": False,
        "cards": [{"endpoint": "study.study_page", "title": "英単語学習", "description": "", "image": ""}],
    },
    {
        "id": "pingpong",
        "visible": False,
        "cards": [{"endpoint": "pingpong.pingpong", "title": "ピンポン", "description": "", "image": ""}],
    },
    {
        "id": "ut_eitan_quiz",
        "visible": False,
        "cards": [{"endpoint": "ut_eitan_quiz.quiz_home", "title": "英単語クイズ", "description": "", "image": ""}],
    },
    {
        "id": "howtoimprovecrawl",
        "visible": True,
        "cards": [{
            "endpoint": "howtoimprovecrawl.howtoimprovecrawl",
            "title": "既存シートを高速版に切り替える",
            "description": "写真付き手順書",
            "image": "",
        }],
    },
]
