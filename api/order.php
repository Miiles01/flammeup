<?php
require __DIR__ . '/lib.php';

$method = $_SERVER['REQUEST_METHOD'];

// Suivi public d'une commande par son jeton.
if ($method === 'GET') {
    $token = (string)($_GET['t'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $token)) fail('Commande introuvable.', 404);
    $stmt = db()->prepare('SELECT * FROM orders WHERE token = ?');
    $stmt->execute([$token]);
    $order = $stmt->fetch();
    if (!$order) fail('Commande introuvable.', 404);
    json_out(order_public($order));
}

if ($method !== 'POST') fail('Méthode non permise.', 405);

$in = body();
$store = store_status();
if (!$store['accepting']) fail('Les commandes en ligne sont en pause pour le moment. Appelez-nous !', 409);

// Anti-abus.
$rl = config('rate_limit');
$stmt = db()->prepare("SELECT COUNT(*) FROM orders WHERE ip = ? AND created_at >= ?");
$stmt->execute([client_ip(), date('Y-m-d H:i:s', time() - $rl['window'] * 60)]);
if ((int)$stmt->fetchColumn() >= $rl['max']) fail('Trop de commandes en peu de temps. Réessayez dans quelques minutes.', 429);

$name = trim((string)($in['name'] ?? ''));
$phone = trim((string)($in['phone'] ?? ''));
$note = trim((string)($in['note'] ?? ''));
$pickup = (string)($in['pickup'] ?? '');
$lines = $in['items'] ?? [];

$errors = [];
if (mb_strlen($name) < 2 || mb_strlen($name) > 60) $errors['name'] = 'Indiquez votre prénom.';
$digits = preg_replace('/\D/', '', $phone);
if (strlen($digits) < 10 || strlen($digits) > 15) $errors['phone'] = 'Numéro de téléphone invalide.';
if (mb_strlen($note) > 280) $errors['note'] = '280 caractères maximum.';
if (!is_array($lines) || !$lines || count($lines) > 30) $errors['items'] = 'Votre commande est vide.';

$asap = $pickup === 'asap';
if ($asap && !$store['asap_available']) $errors['pickup'] = 'Nous sommes fermés en ce moment, choisissez une heure.';
if (!$asap && !in_array($pickup, $store['slots'], true)) $errors['pickup'] = 'Choisissez une heure de ramassage valide.';
if ($errors) json_out(['error' => 'Vérifiez le formulaire.', 'fields' => $errors], 422);

// Prix recalculés côté serveur — on ne fait jamais confiance au navigateur.
$products = [];
foreach (db()->query('SELECT * FROM products') as $p) $products[$p['id']] = $p;
$sauces = [];
foreach (db()->query('SELECT * FROM sauces') as $s) $sauces[$s['id']] = $s;

$items = [];
$subtotal = 0;
foreach ($lines as $line) {
    $p = $products[$line['id'] ?? ''] ?? null;
    $qty = (int)($line['qty'] ?? 0);
    if (!$p || !$p['available']) fail('Un article de votre commande n’est plus disponible. Mettez votre panier à jour.', 409);
    if ($qty < 1 || $qty > 20) fail('Quantité invalide.');

    $sauceName = null;
    if ($p['has_sauce']) {
        $s = $sauces[$line['sauce'] ?? ''] ?? null;
        if (!$s || !$s['available']) fail('Choisissez une sauce disponible pour « ' . $p['name'] . ' ».', 409);
        $sauceName = $s['name'];
    }
    $lineTotal = (int)$p['price_cents'] * $qty;
    $subtotal += $lineTotal;
    $items[] = ['name' => $p['name'], 'sauce' => $sauceName, 'qty' => $qty, 'unit_cents' => (int)$p['price_cents'], 'total_cents' => $lineTotal];
}

$tax = (int)round($subtotal * config('tax_rate'));
$now = date('Y-m-d H:i:s');
$pickupAt = $asap ? date('Y-m-d H:i:s', time() + config('prep_minutes') * 60) : date('Y-m-d') . ' ' . $pickup . ':00';

// Numéro court du jour : 001, 002…
$pdo = db();
$pdo->beginTransaction();
$stmt = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE created_at >= ?");
$stmt->execute([date('Y-m-d 00:00:00')]);
$number = str_pad((string)((int)$stmt->fetchColumn() + 1), 3, '0', STR_PAD_LEFT);
$token = bin2hex(random_bytes(16));

$pdo->prepare('INSERT INTO orders (number, token, customer_name, phone, note, pickup_at, asap, items_json, subtotal_cents, tax_cents, total_cents, status, ip, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ->execute([$number, $token, $name, $phone, $note, $pickupAt, $asap ? 1 : 0, json_encode($items, JSON_UNESCAPED_UNICODE), $subtotal, $tax, $subtotal + $tax, 'new', client_ip(), $now, $now]);
$pdo->commit();

json_out(['token' => $token, 'number' => $number, 'pickup_at' => $pickupAt, 'asap' => $asap, 'total_cents' => $subtotal + $tax], 201);
