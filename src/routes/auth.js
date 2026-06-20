const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../services/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'perfecaire-secret-key-change-in-production';

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM users WHERE username = ?', [username]);
    
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const row = result[0].values[0];
    const user = { id: row[0], username: row[1], password: row[2] };

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Não autenticado' });

  try {
    const token = auth.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ id: decoded.id, username: decoded.username });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
