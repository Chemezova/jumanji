# Шифрует колоду: content/cards.js + content/cards-*.js -> deck.js
# Пароль — content/password.txt. Соль хранится в content/salt.txt и не меняется,
# чтобы телефон, который уже ввёл пароль, не спрашивал его после каждого обновления.
# Запуск: py build.py

import base64, json, os, sys
from pathlib import Path
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).parent
CONTENT = ROOT / 'content'
ITER = 600_000

b64 = lambda b: base64.b64encode(b).decode()

password = (CONTENT / 'password.txt').read_text(encoding='utf-8').strip()
if len(password) < 8:
    sys.exit('Пароль короче 8 символов — слишком легко подобрать')

salt_file = CONTENT / 'salt.txt'
if not salt_file.exists():
    salt_file.write_text(b64(os.urandom(16)))
salt = base64.b64decode(salt_file.read_text().strip())

key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
iv = os.urandom(12)
# cards.js — основа (арсенал, штрафы, первые карты), cards-*.js — партии карт: CARDS.push(...)
parts = [CONTENT / 'cards.js'] + sorted(CONTENT.glob('cards-*.js'))
plain = '\n'.join(p.read_text(encoding='utf-8') for p in parts)
data = AESGCM(key).encrypt(iv, plain.encode(), None)

deck = {'salt': b64(salt), 'iv': b64(iv), 'iter': ITER, 'data': b64(data)}
(ROOT / 'deck.js').write_text(
    '// Колода в зашифрованном виде. Собирается из content/cards.js командой py build.py\n'
    'const DECK = ' + json.dumps(deck) + ';\n', encoding='utf-8')
print(f'deck.js готов: {len(plain)} символов колоды зашифровано')
