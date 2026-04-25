const express = require('express');
const Joi = require('joi');
const { query } = require('../db');

const router = express.Router();

// Validation schemas
const createAccountSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^[0-9+\-\s]{7,15}$/).optional(),
  account_type: Joi.string().valid('SAVINGS', 'CURRENT').default('SAVINGS'),
  initial_deposit: Joi.number().min(0).default(0)
});

// ─────────────────────────────────────────
// POST /api/accounts  →  Create Account
// ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const { error, value } = createAccountSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { full_name, email, phone, account_type, initial_deposit } = value;

  try {
    // Check if email already exists
    const existing = await query('SELECT id FROM accounts WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Create account
    const accResult = await query(
      `INSERT INTO accounts (full_name, email, phone, account_type, balance, account_number)
       VALUES ($1, $2, $3, $4, $5, '')
       RETURNING *`,
      [full_name, email, phone || null, account_type, initial_deposit]
    );

    const account = accResult.rows[0];

    // Record initial deposit transaction if any
    if (initial_deposit > 0) {
      await query(
        `INSERT INTO transactions (account_id, type, amount, description, balance_after)
         VALUES ($1, 'CREDIT', $2, 'Initial deposit', $3)`,
        [account.id, initial_deposit, initial_deposit]
      );
    }

    res.status(201).json({
      message: 'Account created successfully',
      account: {
        id: account.id,
        account_number: account.account_number,
        full_name: account.full_name,
        email: account.email,
        phone: account.phone,
        account_type: account.account_type,
        balance: parseFloat(account.balance),
        status: account.status,
        created_at: account.created_at
      }
    });
  } catch (err) {
    console.error('Create account error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// ─────────────────────────────────────────
// GET /api/accounts/:identifier  →  Get Account
// ─────────────────────────────────────────
router.get('/:identifier', async (req, res) => {
  const { identifier } = req.params;

  try {
    const result = await query(
      `SELECT id, account_number, full_name, email, phone, account_type,
              balance, status, created_at, updated_at
       FROM accounts
       WHERE account_number = $1 OR email = $1 OR id::text = $1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = result.rows[0];
    res.json({
      ...account,
      balance: parseFloat(account.balance)
    });
  } catch (err) {
    console.error('Get account error:', err);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

// ─────────────────────────────────────────
// GET /api/accounts  →  List All Accounts
// ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, account_number, full_name, email, account_type, balance, status, created_at
       FROM accounts ORDER BY created_at DESC LIMIT 100`
    );
    res.json(result.rows.map(a => ({ ...a, balance: parseFloat(a.balance) })));
  } catch (err) {
    console.error('List accounts error:', err);
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

module.exports = router;
