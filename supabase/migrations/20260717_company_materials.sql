-- Contractor materials preferences (run manually in Supabase if not already applied)

ALTER TABLE product_approvals
ADD COLUMN IF NOT EXISTS needs_verification boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS submitted_by_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS verified_at timestamptz,
ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS company_materials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  product_approval_id uuid REFERENCES product_approvals(id) ON DELETE CASCADE NOT NULL,
  layer_type text NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, product_approval_id)
);

CREATE INDEX IF NOT EXISTS company_materials_company_id_idx
  ON company_materials (company_id);

CREATE INDEX IF NOT EXISTS company_materials_layer_type_idx
  ON company_materials (company_id, layer_type);
