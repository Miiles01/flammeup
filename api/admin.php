<?php
require __DIR__ . '/lib.php';

$action = (string)($_GET['action'] ?? '');
start_admin_session();

if ($action === 'login') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Méthode non permise.', 405);
    usleep(300000); // ralentit le forçage
    $password = (string)(body()['password'] ?? '');
    if (!password_verify($password, config('admin_password_hash'))) fail('Mot de passe incorrect.', 401);
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    json_out(['csrf' => $_SESSION['csrf']]);
}

if ($action === 'session') {
    json_out(['authenticated' => !empty($_SESSION['admin']), 'csrf' => $_SESSION['csrf'] ?? null]);
}

require_admin();
$in = body();

switch ($action) {
    case 'logout':
        $_SESSION = [];
        session_destroy();
        json_out(['ok' => true]);

    case 'orders':
        // Commandes du jour + toute commande encore active.
        $stmt = db()->prepare("SELECT * FROM orders WHERE created_at >= ? OR status IN ('new','preparing','ready') ORDER BY pickup_at ASC, id ASC");
        $stmt->execute([date('Y-m-d 00:00:00')]);
        $orders = array_map(fn($o) => order_public($o) + ['id' => (int)$o['id'], 'phone' => $o['phone'], 'note' => $o['note']], $stmt->fetchAll());
        json_out(['orders' => $orders, 'store' => store_status(), 'server_time' => date('Y-m-d H:i:s')]);

    case 'status':
        $status = (string)($in['status'] ?? '');
        if (!in_array($status, STATUSES, true)) fail('Statut invalide.');
        db()->prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
            ->execute([$status, date('Y-m-d H:i:s'), (int)($in['id'] ?? 0)]);
        json_out(['ok' => true]);

    case 'menu':
        json_out([
            'products' => db()->query('SELECT * FROM products ORDER BY sort')->fetchAll(),
            'sauces' => db()->query('SELECT * FROM sauces ORDER BY sort')->fetchAll(),
        ]);

    case 'product':
        $fields = [];
        $params = [];
        if (isset($in['available'])) { $fields[] = 'available = ?'; $params[] = $in['available'] ? 1 : 0; }
        if (isset($in['price_cents'])) {
            $price = (int)$in['price_cents'];
            if ($price < 0 || $price > 100000) fail('Prix invalide.');
            $fields[] = 'price_cents = ?'; $params[] = $price;
        }
        if (!$fields) fail('Rien à modifier.');
        $params[] = (string)($in['id'] ?? '');
        db()->prepare('UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
        json_out(['ok' => true]);

    case 'sauce':
        db()->prepare('UPDATE sauces SET available = ? WHERE id = ?')
            ->execute([!empty($in['available']) ? 1 : 0, (string)($in['id'] ?? '')]);
        json_out(['ok' => true]);

    case 'accepting':
        set_setting('accepting', !empty($in['accepting']) ? '1' : '0');
        json_out(['ok' => true, 'store' => store_status()]);
}

fail('Action inconnue.', 404);
