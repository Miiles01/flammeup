<?php
declare(strict_types=1);

$CONFIG = require __DIR__ . '/config.php';
date_default_timezone_set($CONFIG['timezone']);

const STATUSES = ['new', 'preparing', 'ready', 'picked_up', 'cancelled'];

function config(string $key)
{
    global $CONFIG;
    return $CONFIG[$key];
}

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $code = 400): void
{
    json_out(['error' => $message], $code);
}

function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;

    $path = config('db_path');
    $fresh = !file_exists($path);
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0775, true);

    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');
    if ($fresh) migrate($pdo);
    upgrade($pdo);
    return $pdo;
}

const MENU_VERSION = '4';

/** Mises à jour de schéma et de menu, sans toucher aux commandes existantes. */
function upgrade(PDO $pdo): void
{
    $cols = array_column($pdo->query('PRAGMA table_info(products)')->fetchAll(), 'name');
    if (!in_array('image', $cols, true)) $pdo->exec("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''");
    $ocols = array_column($pdo->query('PRAGMA table_info(orders)')->fetchAll(), 'name');
    if (!in_array('events_json', $ocols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]'");

    // Photos passées du CDN Unsplash aux fichiers locaux (garde prix et disponibilités).
    $pdo->exec("UPDATE products SET image = 'assets/img/menu/' || id || '.jpg' WHERE image LIKE 'unsplash:%'");

    $stmt = $pdo->prepare('SELECT value FROM settings WHERE key = ?');
    $stmt->execute(['menu_version']);
    if ($stmt->fetchColumn() !== MENU_VERSION) {
        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM products');
        seed_menu($pdo);
        $pdo->prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            ->execute(['menu_version', MENU_VERSION]);
        $pdo->commit();
    }
}

function local_photo(string $productId): string
{
    return 'assets/img/menu/' . $productId . '.jpg';
}

/**
 * Menu de départ (à ajuster avec le client depuis le panneau).
 * Photos : Unsplash (licence libre, usage commercial permis), téléchargées dans assets/img/menu/<id>.jpg.
 */
function seed_menu(PDO $pdo): void
{
    $u = fn(string $id) => 'unsplash:' . $id;
    // id, catégorie, nom, description, prix, sauce au choix, vedette, photo
    $products = [
        ['ailes-6', 'ailes', '6 ailes flamantes', 'Six ailes croustillantes, grillées à la flamme et nappées de la sauce de votre choix.', 1199, 1, 0, $u('photo-1645371958635-88dd6c8e1be7')],
        ['ailes-12', 'ailes', '12 ailes flamantes', 'La portion pour les vraies faims. Céleri et trempette ranch inclus.', 2199, 1, 1, $u('photo-1567620832903-9fc6debc209f')],
        ['ailes-24', 'ailes', 'Plateau 24 ailes', 'Le plateau à partager, deux sauces c’est mieux : précisez-la en note.', 3999, 1, 0, $u('photo-1614398751058-eb2e0bf63e53')],
        ['tenders-5', 'ailes', '5 tenders croustillants', 'Filets de poulet panés à la main, tendres dedans, croquants dehors.', 1399, 1, 0, $u('photo-1647724394693-2c93af726785')],
        ['burger-flamme', 'burgers', 'Le Flamme', 'Double galette smashée, cheddar fondu, oignons caramélisés et sauce La Flamme.', 1649, 0, 1, $u('photo-1607013251379-e6eecfffe234')],
        ['burger-poulet', 'burgers', 'Burger poulet croustillant', 'Poulet pané, salade de chou, cornichons et la sauce de votre choix.', 1499, 1, 0, $u('photo-1703219342329-fce8488cf443')],
        ['burger-classique', 'burgers', 'Le Classique', 'Bœuf grillé, cheddar, laitue, tomate, oignon rouge et sauce maison.', 1399, 0, 0, $u('photo-1568901346375-23c9450c58cd')],
        ['tacos-poulet', 'tacos', 'Trio tacos poulet', 'Trois tacos : poulet grillé, pico de gallo, avocat et crème lime.', 1299, 0, 1, $u('photo-1565299585323-38d6b0865b47')],
        ['tacos-boeuf', 'tacos', 'Trio tacos bœuf', 'Trois tacos : bœuf braisé, oignon, coriandre et salsa verde.', 1349, 0, 0, $u('photo-1599974579688-8dbdd335c77f')],
        ['frites', 'frites', 'Frites maison', 'Coupées ici, cuites deux fois, salées juste comme il faut.', 499, 0, 0, $u('photo-1606755456206-b25206cde27e')],
        ['frites-cajun', 'frites', 'Frites cajun', 'Nos frites maison, relevées d’un mélange cajun fumé, trempette à l’ail.', 599, 0, 0, $u('photo-1598679253544-2c97992403ea')],
        ['frites-chargees', 'frites', 'Frites chargées', 'Sauce fromage, bœuf haché épicé, oignons verts. À partager… ou pas.', 999, 0, 1, $u('photo-1666304752980-678d5c35c911')],
        ['poutine', 'frites', 'Poutine', 'Frites maison, fromage en grains qui fait squik-squik et sauce brune.', 949, 0, 0, $u('photo-1647482770207-4e8f5ba7b33e')],
        ['combo-flamme', 'combos', 'Combo Flamme', '10 ailes, frites maison et une boisson. Le classique de la maison.', 1999, 1, 1, $u('photo-1639131285716-3fc7f624f138')],
        ['combo-burger', 'combos', 'Combo burger', 'Le Classique, frites maison et une boisson.', 1799, 0, 0, $u('photo-1594212699903-ec8a3eca50f5')],
        ['boisson', 'boissons', 'Boisson gazeuse', 'Canette 355 ml, bien froide.', 249, 0, 0, $u('photo-1629654613528-5d0a2e4166de')],
    ];
    $stmt = $pdo->prepare('INSERT INTO products (id, category, name, description, price_cents, has_sauce, featured, image, sort) VALUES (?,?,?,?,?,?,?,?,?)');
    foreach ($products as $i => $p) {
        $p[7] = local_photo($p[0]); // l'id Unsplash reste en source ; la photo est servie depuis assets/
        $stmt->execute([...$p, $i]);
    }
}

function migrate(PDO $pdo): void
{
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            price_cents INTEGER NOT NULL,
            has_sauce INTEGER NOT NULL DEFAULT 0,
            featured INTEGER NOT NULL DEFAULT 0,
            available INTEGER NOT NULL DEFAULT 1,
            sort INTEGER NOT NULL DEFAULT 0,
            image TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS sauces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            heat INTEGER NOT NULL DEFAULT 1,
            color TEXT NOT NULL,
            available INTEGER NOT NULL DEFAULT 1,
            sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            customer_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            pickup_at TEXT NOT NULL,
            asap INTEGER NOT NULL DEFAULT 0,
            items_json TEXT NOT NULL,
            subtotal_cents INTEGER NOT NULL,
            tax_cents INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'new',
            ip TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            events_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    SQL);

    $sauces = [
        ['miel-ail', 'Miel & ail', 'Douce, collante, irrésistible.', 1, '#F5B642'],
        ['bbq-fume', 'BBQ fumé', 'Fumée de noyer, touche de mélasse.', 1, '#8A3B1E'],
        ['citron-poivre', 'Citron poivre', 'Sèche, zestée, poivre concassé.', 2, '#E9D66B'],
        ['buffalo', 'Buffalo classique', 'Beurre et piment fort, la base.', 3, '#E0652B'],
        ['parm-ail', 'Parmesan & ail', 'Crémeuse, fromagère, sans piquant.', 1, '#EDE3C8'],
        ['flamme', 'La Flamme', 'Habanero et piment fantôme. Vous êtes prévenus.', 5, '#C8261B'],
    ];
    $stmt = $pdo->prepare('INSERT INTO sauces (id, name, description, heat, color, sort) VALUES (?,?,?,?,?,?)');
    foreach ($sauces as $i => $s) $stmt->execute([...$s, $i]);

    $pdo->exec("INSERT INTO settings (key, value) VALUES ('accepting', '1')");
}

function setting(string $key, string $default = ''): string
{
    $stmt = db()->prepare('SELECT value FROM settings WHERE key = ?');
    $stmt->execute([$key]);
    $v = $stmt->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function set_setting(string $key, string $value): void
{
    db()->prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        ->execute([$key, $value]);
}

/** Heures d'ouverture du jour, en DateTime, ou null si fermé. */
function today_hours(?DateTimeImmutable $now = null): ?array
{
    $now = $now ?? new DateTimeImmutable();
    $h = config('hours')[(int)$now->format('w')] ?? null;
    if (!$h) return null;
    [$open, $close] = $h;
    return [
        new DateTimeImmutable($now->format('Y-m-d') . ' ' . $open),
        new DateTimeImmutable($now->format('Y-m-d') . ' ' . $close),
    ];
}

/** Créneaux de ramassage disponibles pour aujourd'hui (HH:MM). */
function pickup_slots(): array
{
    $now = new DateTimeImmutable();
    $hours = today_hours($now);
    if (!$hours) return [];
    [$open, $close] = $hours;

    $step = config('slot_minutes') * 60;
    $earliest = max($now->getTimestamp() + config('prep_minutes') * 60, $open->getTimestamp() + config('prep_minutes') * 60);
    $t = (int)(ceil($earliest / $step) * $step);

    $slots = [];
    for (; $t <= $close->getTimestamp(); $t += $step) $slots[] = date('H:i', $t);
    return $slots;
}

function store_status(): array
{
    $now = new DateTimeImmutable();
    $hours = today_hours($now);
    $openNow = $hours && $now >= $hours[0] && $now < $hours[1];
    $slots = pickup_slots();

    return [
        'accepting' => setting('accepting', '1') === '1',
        'open_now' => $openNow,
        'asap_available' => $openNow,
        'slots' => $slots,
        'prep_minutes' => config('prep_minutes'),
        'tax_rate' => config('tax_rate'),
        'hours' => config('hours'),
        'today' => (int)$now->format('w'),
    ];
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 64);
}

function start_admin_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('flamme_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure' => !empty($_SERVER['HTTPS']),
    ]);
    session_start();
}

function require_admin(): void
{
    start_admin_session();
    if (empty($_SESSION['admin'])) fail('Session expirée.', 401);
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals($_SESSION['csrf'] ?? '', $token)) fail('Jeton invalide.', 403);
    }
}

/** Enregistre une commande (utilisé par le site et par la commande de démonstration). */
function insert_order(string $name, string $phone, string $note, string $pickupAt, bool $asap, array $items, int $subtotal): array
{
    $tax = (int)round($subtotal * config('tax_rate'));
    $now = date('Y-m-d H:i:s');
    $pdo = db();
    $pdo->beginTransaction();
    // Numéro court du jour : 001, 002…
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE created_at >= ?");
    $stmt->execute([date('Y-m-d 00:00:00')]);
    $number = str_pad((string)((int)$stmt->fetchColumn() + 1), 3, '0', STR_PAD_LEFT);
    $token = bin2hex(random_bytes(16));
    $events = json_encode([['status' => 'new', 'at' => $now]]);
    $pdo->prepare('INSERT INTO orders (number, token, customer_name, phone, note, pickup_at, asap, items_json, subtotal_cents, tax_cents, total_cents, status, ip, created_at, updated_at, events_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([$number, $token, $name, $phone, $note, $pickupAt, $asap ? 1 : 0, json_encode($items, JSON_UNESCAPED_UNICODE), $subtotal, $tax, $subtotal + $tax, 'new', client_ip(), $now, $now, $events]);
    $pdo->commit();
    return ['token' => $token, 'number' => $number, 'total_cents' => $subtotal + $tax];
}

function order_public(array $o): array
{
    return [
        'number' => $o['number'],
        'status' => $o['status'],
        'customer_name' => $o['customer_name'],
        'pickup_at' => $o['pickup_at'],
        'asap' => (bool)$o['asap'],
        'items' => json_decode($o['items_json'], true),
        'subtotal_cents' => (int)$o['subtotal_cents'],
        'tax_cents' => (int)$o['tax_cents'],
        'total_cents' => (int)$o['total_cents'],
        'created_at' => $o['created_at'],
    ];
}
