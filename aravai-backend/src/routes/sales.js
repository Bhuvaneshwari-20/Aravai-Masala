const router = require('express').Router();
const c = require('../controllers/salesController');
const { authenticate, authorize } = require('../middleware/auth');

// permission module: 'sales'  (view = see screens, create = new sale / return / customer, edit = edit customer / settle return, delete = cancel sale)

// CSV is opened in the browser, which cannot send a header: accept ?token= for that one route
router.use('/reports/monthly.csv', (req, res, next) => {
  if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  next();
});
router.use(authenticate);

router.get('/lookups', authorize('sales', 'view'), c.lookups);
router.get('/dashboard', authorize('sales', 'view'), c.dashboard);
router.get('/reports/monthly', authorize('sales', 'view'), c.monthlyReport);
router.get('/reports/monthly.csv', authorize('sales', 'view'), c.monthlyCsv);

router.get('/customers', authorize('sales', 'view'), c.listCustomers);
router.post('/customers', authorize('sales', 'create'), c.createCustomer);
router.put('/customers/:id', authorize('sales', 'edit'), c.updateCustomer);

router.get('/history', authorize('sales', 'view'), c.history);

// returns (static paths first, so they are never mistaken for a sale id)
router.get('/returns/invoices', authorize('sales', 'view'), c.returnableInvoices);
router.get('/returns', authorize('sales', 'view'), c.listReturns);
router.post('/returns', authorize('sales', 'create'), c.createReturn);
router.put('/returns/:id/status', authorize('sales', 'edit'), c.setReturnStatus);
router.post('/returns/:id/settle', authorize('sales', 'edit'), c.settleReturn);
router.get('/returns/:id', authorize('sales', 'view'), c.getReturn);

router.get('/stock-card/:packingRateId', authorize('sales', 'view'), c.stockCard);

// invoices (service-level shape)
router.post('/invoices', authorize('sales', 'create'), c.createInvoice);
router.get('/invoices/:id', authorize('sales', 'view'), c.getInvoice);
router.post('/invoices/:id/cancel', authorize('sales', 'delete'), c.cancelInvoice);

// sales as the app uses them: GET /sales, POST /sales, GET /sales/:id (numeric id only, kept last)
router.get('/', authorize('sales', 'view'), c.listSales);
router.post('/', authorize('sales', 'create'), c.createSale);
const numeric = (h) => (req, res, next) => (/^\d+$/.test(req.params.id) ? h(req, res, next) : next());
router.get('/:id', authorize('sales', 'view'), numeric(c.getSale));
router.post('/:id/cancel', authorize('sales', 'delete'), numeric(c.cancelInvoice));
module.exports = router;