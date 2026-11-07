"""Generate this journal's environment settings locally, without printing secrets."""
import argparse
import getpass
import os
import secrets
from datetime import date
from pathlib import Path

from werkzeug.security import generate_password_hash


def main():
    parser = argparse.ArgumentParser(description='Mizki & Karen の合言葉をハッシュ化し、ローカルの設定ファイルへ保存します。')
    parser.add_argument('--output', type=Path, default=Path('.env.mizkiandkaren'))
    args = parser.parse_args()
    password = getpass.getpass('ふたりの合言葉（4文字以上）: ')
    if len(password) < 4:
        raise SystemExit('4文字以上の合言葉を設定してください。')
    if password != getpass.getpass('もう一度入力: '):
        raise SystemExit('合言葉が一致しません。')
    try:
        anniversary = date.fromisoformat(input('付き合い始めの日付（YYYY-MM-DD、日本時間の午前0時）: ').strip())
    except ValueError:
        raise SystemExit('日付は YYYY-MM-DD で入力してください。') from None
    content = '\n'.join([
        'MIZKI_KAREN_SECRET_KEY=' + secrets.token_urlsafe(48),
        'MIZKI_KAREN_PASSPHRASE_HASH=' + generate_password_hash(password),
        'MIZKI_KAREN_GAS_URL=',
        'MIZKI_KAREN_GAS_SECRET=',
        'MIZKI_KAREN_ANNIVERSARY_START=' + anniversary.isoformat() + 'T00:00:00+09:00',
        '',
    ])
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(content)
    print(f'{args.output} に設定を保存しました。このファイルを共有・コミットせず、Render の Environment へ値を設定してください。')


if __name__ == '__main__':
    main()
