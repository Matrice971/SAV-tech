"""
Génère un fichier .txt chiffré selon le format défini dans docs/chiffrement.md
(salt.iv.ciphertext en Base64, PBKDF2-HMAC-SHA256 + AES-256-GCM), pour tester
manuellement le circuit de déchiffrement de l'appli client.

Ce script ne se connecte pas au relais Cloudflare : il produit seulement un
fichier local. Voir docs/chiffrement.md, section "Comment tester", pour
l'envoyer ensuite via curl.

Dépendance externe requise :
    pip install cryptography

Utilisation :
    python3 generer_fichier_test.py
(modifier PASSWORD et TEST_DATA ci-dessous selon les besoins du test)
"""

import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# --- Paramètres modifiables pour le test ---

PASSWORD = "motdepasse-test"

TEST_DATA = {
    "contact": "Jean Dupont",
    "appareils": [
        {
            "type": "Banc de frein",
            "num_serie": "BF-2024-0088",
            "centre_origine": "Centre Nord",
            "adresse": "12 rue Example, 97100 Basse-Terre",
            "etat": 2,
            "date_prise_charge": "2026-07-20",
            "lieu_prise_charge": "atelier",
            "piece_en_commande": True,
            "materiel_prete_num_serie": "PRET-0012",
            "commentaire_technicien": "Diagnostic en cours, pièce commandée",
            "date_remise_service": None,
        },
        {
            "type": "Opacimètre",
            "num_serie": "OP-2023-0142",
            "centre_origine": "Centre Sud",
            "adresse": "5 avenue Example, 97110 Pointe-à-Pitre",
            "etat": 4,
            "date_prise_charge": "2026-06-15",
            "lieu_prise_charge": "site",
            "piece_en_commande": False,
            "materiel_prete_num_serie": None,
            "commentaire_technicien": "Réparé et testé, remis en service",
            # Moins de 90 jours avant la date du script (2026-08-12) :
            # doit rester visible une fois le filtre implémenté.
            "date_remise_service": "2026-07-25",
        },
    ],
}

OUTPUT_FILE = "test_chiffre.txt"

# --- Paramètres cryptographiques (doivent rester identiques à ceux du JS,
#     voir docs/chiffrement.md section 6) ---

SALT_LENGTH = 16
IV_LENGTH = 12
PBKDF2_ITERATIONS = 100_000
KEY_LENGTH = 32  # 256 bits


def derive_key(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
        dklen=KEY_LENGTH,
    )


def encrypt(password: str, plaintext: str) -> str:
    salt = os.urandom(SALT_LENGTH)
    iv = os.urandom(IV_LENGTH)
    key = derive_key(password, salt)

    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)

    salt_b64 = base64.b64encode(salt).decode("ascii")
    iv_b64 = base64.b64encode(iv).decode("ascii")
    ciphertext_b64 = base64.b64encode(ciphertext).decode("ascii")

    return f"{salt_b64}.{iv_b64}.{ciphertext_b64}"


def main():
    plaintext = json.dumps(TEST_DATA, ensure_ascii=False)
    encrypted = encrypt(PASSWORD, plaintext)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(encrypted)

    print(f"Fichier chiffré écrit dans : {OUTPUT_FILE}")
    print(f"Mot de passe utilisé : {PASSWORD}")


if __name__ == "__main__":
    main()
