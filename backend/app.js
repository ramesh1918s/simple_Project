const express = require('express');
const mysql = require('mysql2');
const app = express();

const db = mysql.createConnection({
  host: 'db',
  user: 'root',
  password: 'root',
  database: 'tasksdb'
});

app.get('/tasks', (req, res) => {
  db.query('SELECT * FROM tasks', (err, result) => {
    if (err) throw err;
    res.json(result);
  });
});

app.listen(3000, () => console.log('Backend running'));
