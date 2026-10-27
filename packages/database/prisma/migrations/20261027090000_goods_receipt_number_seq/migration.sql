-- Receipt numbers (GR-0001, ...) come from a sequence so two concurrent receipts for different
-- orders can never be handed the same number. Gaps after a rollback are expected and harmless.
CREATE SEQUENCE "goods_receipt_number_seq";
