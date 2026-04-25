const express = require('express');
const Joi = require('joi');
const { query, pool } = require('../db');

const router = express.Router();

// Validation
const depositSchema = Joi.object({
  account_identifier: Joi.string().required(),
  amount: Joi.number().positive().max(1000000).required(),
  description: Joi.string().max(200).optional()
});

const balanceSchema = Joi.object({
  account_identifier: Joi.string().required()
});

// Helper: find account
async function findAccount(identifier) {
  const result = await query(
    `SELECT * FROM accounts WHERE account_number = $1 OR email = $1 OR id::text = $1`,
    [identifier]
  );
  return result.rows[0] || null;
}

// ─────────────────────────────────────────
// POST /api/transactions/deposit  →  Add Money
// ─────────────────────────────────────────
router.post('/deposit', async (req, res) => {
  const { error, value } = depositSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { account_identifier, amount, description } = value;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const accResult = await client.query(
      `SELECT * FROM accounts WHERE account_number = $1 OR email = $1 OR id::text = $1 FOR UPDATE`,
      [account_identifier]
    );

    if (accResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accResult.rows[0];

    if (account.status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Account is not active' });
    }

    const newBalance = parseFloat(account.balance) + amount;

    await client.query(
      `UPDATE accounts SET balance = $1 WHERE id = $2`,
      [newBalance, account.id]
    );

    const txResult = await client.query(
      `INSERT INTO transactions (account_id, type, amount, description, balance_after)
       VALUES ($1, 'CREDIT', $2, $3, $4) RETURNING *`,
      [account.id, amount, description || 'Deposit', newBalance]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Deposit successful',
      transaction: {
        id: txResult.rows[0].id,
        type: 'CREDIT',
        amount,
        description: txResult.rows[0].description,
        balance_after: newBalance,
        created_at: txResult.rows[0].created_at
      },
      account: {
        account_number: account.account_number,
        full_name: account.full_name,
        new_balance: newBalance
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Deposit error:', err);
    res.status(500).json({ error: 'Deposit failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────
// GET /api/transactions/balance/:identifier  →  Check Balance
// ─────────────────────────────────────────
router.get('/balance/:identifier', async (req, res) => {
  try {
    const account = await findAccount(req.params.identifier);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Get last 5 transactions
    const txResult = await query(
      `SELECT type, amount, description, balance_after, created_at
       FROM transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [account.id]
    );

    res.json({
      account_number: account.account_number,
      full_name: account.full_name,
      account_type: account.account_type,
      status: account.status,
      balance: parseFloat(account.balance),
      last_updated: account.updated_at,
      recent_transactions: txResult.rows.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        balance_after: parseFloat(t.balance_after)
      }))
    });
  } catch (err) {
    console.error('Balance check error:', err);
    res.status(500).json({ error: 'Failed to check balance' });
  }
});

// ─────────────────────────────────────────
// GET /api/transactions/:account_identifier  →  Transaction History
// ─────────────────────────────────────────
router.get('/:account_identifier', async (req, res) => {
  try {
    const account = await findAccount(req.params.account_identifier);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await query(
      `SELECT id, type, amount, description, balance_after, created_at
       FROM transactions WHERE account_id = $1 ORDER BY created_at DESC`,
      [account.id]
    );

    res.json({
      account_number: account.account_number,
      full_name: account.full_name,
      transactions: result.rows.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        balance_after: parseFloat(t.balance_after)
      }))
    });
  } catch (err) {
    console.error('Transaction history error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
