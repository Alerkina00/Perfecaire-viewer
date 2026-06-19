const express = require('express');
const path = require('path');

const router = express.Router();

// GET /v/:slug — serve a página do viewer (público, sem auth)
router.get('/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/public/viewer.html'));
});

module.exports = router;
