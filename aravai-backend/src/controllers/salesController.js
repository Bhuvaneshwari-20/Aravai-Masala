const sales = require('../services/salesService');
const returns = require('../services/salesReturnService');
const reports = require('../services/salesReportService');
const compat = require('../services/salesCompatService');
const deliveries = require('../services/salesDeliveryService');
const wrap = require('../utils/asyncWrap');

// dashboard + reports
exports.dashboard = wrap(() => reports.dashboard());
exports.stockSummary = wrap((req) => reports.stockSummary(req.query));

// deliveries / dispatch
exports.pendingDeliveryInvoices = wrap((req) => deliveries.pendingInvoices(req.query));
exports.listDeliveries = wrap((req) => deliveries.list(req.query));
exports.getDelivery = wrap((req) => deliveries.get(req.params.id));
exports.createDelivery = wrap((req) => deliveries.create(req.body, req.user.id, req.ip), 201);
exports.setDeliveryStatus = wrap((req) => deliveries.setStatus(req.params.id, req.body, req.user.id, req.ip));
exports.monthlyReport = wrap((req) => reports.monthlyReport(req.query));
exports.monthlyCsv = async (req, res, next) => {
  try {
    const { name, csv } = await reports.monthlyCsv(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  } catch (e) { next(e); }
};

// lookups, customers / agencies
exports.lookups = wrap(() => compat.lookups());
exports.nextInvoiceNo = wrap(() => sales.peekInvoiceNo());
exports.listCustomers = wrap((req) => sales.listCustomers(req.query));
exports.createCustomer = wrap((req) => sales.createCustomer(req.body, req.user.id, req.ip), 201);
exports.updateCustomer = wrap((req) => sales.updateCustomer(req.params.id, req.body, req.user.id, req.ip));

// sales (what the app calls): list, one sale, new sale, history groups
exports.listSales = wrap((req) => compat.listSales(req.query));
exports.getSale = wrap((req) => compat.getSale(req.params.id));
exports.createSale = wrap((req) => compat.createSale(req.body, req.user.id, req.ip), 201);
exports.history = wrap((req) => compat.groupHistory(req.query));
exports.stockCard = wrap((req) => compat.stockCard(req.params.packingRateId, req.query));

// invoices (service-level shape, kept for other callers)
exports.createInvoice = wrap((req) => sales.createInvoice(req.body, req.user.id, req.ip), 201);
exports.getInvoice = wrap((req) => sales.getInvoice(req.params.id));
exports.cancelInvoice = wrap((req) => sales.cancelInvoice(req.params.id, req.body, req.user.id, req.ip));

// returns
exports.returnableInvoices = wrap((req) => returns.returnableInvoices(req.query));
exports.listReturns = wrap((req) => compat.listReturns(req.query));
exports.getReturn = wrap((req) => returns.get(req.params.id));
exports.createReturn = wrap((req) => compat.createReturn(req.body, req.user.id, req.ip), 201);
exports.setReturnStatus = wrap((req) => compat.setReturnStatus(req.params.id, req.body, req.user.id, req.ip));
exports.settleReturn = wrap((req) => returns.settle(req.params.id, req.user.id, req.ip));