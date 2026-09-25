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
        // today = commandes du jour + toute commande encore active ; week = 7 derniers jours ; all = 500 dernières.
        $range = (string)($_GET['range'] ?? 'today');
        if ($range === 'week') {
            $stmt = db()->prepare("SELECT * FROM orders WHERE created_at >= ? OR status IN ('new','preparing','ready') ORDER BY id DESC");
            $stmt->execute([date('Y-m-d 00:00:00', strtotime('-6 days'))]);
        } elseif ($range === 'all') {
            $stmt = db()->query('SELECT * FROM orders ORDER BY id DESC LIMIT 500');
        } else {
            $stmt = db()->prepare("SELECT * FROM orders WHERE created_at >= ? OR status IN ('new','preparing','ready') ORDER BY id DESC");
            $stmt->execute([date('Y-m-d 00:00:00')]);
        }
        // Photo de chaque article : par id produit, sinon par nom (anciennes commandes).
        $byId = []; $byName = [];
        foreach (db()->query('SELECT id, name, image FROM products') as $p) { $byId[$p['id']] = $p['image']; $byName[$p['name']] = $p['image']; }
        $orders = array_map(function ($o) use ($byId, $byName) {
            $out = order_public($o) + ['id' => (int)$o['id'], 'phone' => $o['phone'], 'note' => $o['note'], 'updated_at' => $o['updated_at']];
            $out['events'] = json_decode($o['events_json'] ?? '[]', true) ?: [['status' => 'new', 'at' => $o['created_at']]];
            foreach ($out['items'] as &$it) $it['image'] = $byId[$it['id'] ?? ''] ?? ($byName[$it['name']] ?? '');
            return $out;
        }, $stmt->fetchAll());
        json_out(['orders' => $orders, 'store' => store_status(), 'server_time' => date('Y-m-d H:i:s')]);

    case 'status':
        $status = (string)($in['status'] ?? '');
        if (!in_array($status, STATUSES, true)) fail('Statut invalide.');
        $id = (int)($in['id'] ?? 0);
        $stmt = db()->prepare('SELECT events_json FROM orders WHERE id = ?');
        $stmt->execute([$id]);
        $events = json_decode((string)$stmt->fetchColumn(), true) ?: [];
        $now = date('Y-m-d H:i:s');
        $events[] = ['status' => $status, 'at' => $now];
        db()->prepare('UPDATE orders SET status = ?, updated_at = ?, events_json = ? WHERE id = ?')
            ->execute([$status, $now, json_encode($events), $id]);
        json_out(['ok' => true, 'events' => $events]);

    case 'demo_order':
        // Commande fictive pour présenter le panneau au client.
        $names = ['Marie-Ève', 'Jérôme', 'Samuel', 'Chloé', 'Olivier', 'Léa', 'Gabriel', 'Camille', 'Mathis', 'Rosalie', 'Félix', 'Juliette'];
        $notes = ['', '', '', 'Sauce à part svp', 'Sans oignons', 'Extra trempette ranch', 'Allergie aux arachides'];
        $products = db()->query('SELECT * FROM products WHERE available = 1')->fetchAll();
        $sauces = db()->query('SELECT name FROM sauces WHERE available = 1')->fetchAll(PDO::FETCH_COLUMN);
        if (!$products) fail('Aucun produit disponible.');
        shuffle($products);
        $items = []; $subtotal = 0;
        foreach (array_slice($products, 0, random_int(1, 3)) as $p) {
            $qty = random_int(1, 2);
            $line = (int)$p['price_cents'] * $qty;
            $subtotal += $line;
            $items[] = ['id' => $p['id'], 'name' => $p['name'], 'sauce' => $p['has_sauce'] && $sauces ? $sauces[array_rand($sauces)] : null,
                        'qty' => $qty, 'unit_cents' => (int)$p['price_cents'], 'total_cents' => $line];
        }
        $asap = random_int(0, 1) === 1;
        $pickupAt = date('Y-m-d H:i:s', time() + ($asap ? config('prep_minutes') : random_int(3, 8) * 15) * 60);
        $order = insert_order($names[array_rand($names)], sprintf('(819) 555-%04d', random_int(100, 9999)), $notes[array_rand($notes)], $pickupAt, $asap, $items, $subtotal);
        json_out(['ok' => true, 'number' => $order['number']]);

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
