# Ubuntu MySQL Auth Setup

## 1. Install runtime

```bash
sudo apt update
sudo apt install -y nodejs npm mysql-server
cd ~/Shim
npm install
```

## 2. Create database and app user

```bash
sudo mysql < db/auth-schema.sql
sudo mysql
```

```sql
CREATE USER IF NOT EXISTS 'shim_app'@'localhost' IDENTIFIED BY 'replace-with-a-long-random-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON shim_gdd.* TO 'shim_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 3. Create the first login user

```bash
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=shim_app
export MYSQL_PASSWORD='replace-with-a-long-random-password'
export MYSQL_DATABASE=shim_gdd

read -rsp "New admin password: " SHIM_PASSWORD
echo
npm run user:create -- admin "관리자" admin
unset SHIM_PASSWORD
```

Passwords are stored as salted `scrypt` hashes. The raw password is never stored in MySQL.

## 4. Run on the LAN

```bash
HOST=0.0.0.0 PORT=8770 npm start
```

Open:

```text
http://SERVER_IP:8770/GDD/index.html
```

## 5. systemd

Copy `deploy/shim-gdd.service.example` to `/etc/systemd/system/shim-gdd.service`, then replace the user, path, and MySQL password.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shim-gdd
sudo systemctl status shim-gdd
```

Use `COOKIE_SECURE=1` only when the site is served over HTTPS.

## 6. GitHub Actions deployment

For a self-hosted runner on the Ubuntu server, add these repository secrets in GitHub:

```text
UBUNTU_APP_DIR=/home/chan/Shim
UBUNTU_SERVICE_NAME=shim-gdd
```

With a self-hosted runner on the Ubuntu server, the deploy workflow runs locally on that server, copies the repository contents into `UBUNTU_APP_DIR`, runs `npm ci --omit=dev`, and restarts `shim-gdd`.

The deploy user must be able to restart only this service without an interactive password. One narrow sudoers rule is:

```text
chan ALL=NOPASSWD: /usr/bin/systemctl restart shim-gdd
```
