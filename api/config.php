<?php
/**
 * Flamme Up — configuration du restaurant.
 * Tout ce que le client peut vouloir changer vit ici (horaires, taxes, mot de passe).
 */
return [
    // Mot de passe du panneau admin. Pour le changer :
    //   php -r 'echo password_hash("nouveau-mot-de-passe", PASSWORD_DEFAULT);'
    // puis coller le résultat ici. (Démo : flamme2026)
    'admin_password_hash' => '$2y$12$pvNawPzDjenB31ySd.zk1uiesOmXucTMqz9DLGxp2pDuPcZ5.LZZ2',

    // Base SQLite. Sur Hostinger, idéalement hors de public_html.
    'db_path' => __DIR__ . '/../data/flamme.sqlite',

    'timezone' => 'America/Toronto',

    // TPS + TVQ (Québec). Mettre 0 si les prix affichés incluent les taxes.
    'tax_rate' => 0.14975,

    // Délai de préparation minimum et intervalle des créneaux de ramassage.
    'prep_minutes' => 20,
    'slot_minutes' => 15,

    // Horaires par jour (0 = dimanche … 6 = samedi). null = fermé.
    'hours' => [
        0 => ['11:30', '21:00'],
        1 => null,
        2 => ['11:30', '21:00'],
        3 => ['11:30', '21:00'],
        4 => ['11:30', '22:00'],
        5 => ['11:30', '23:00'],
        6 => ['11:30', '23:00'],
    ],

    // Anti-abus : nombre max de commandes par IP sur la fenêtre (minutes).
    'rate_limit' => ['max' => 5, 'window' => 10],
];
