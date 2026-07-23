## ADDED Requirements

### Requirement: Unified admin config tree

The system SHALL expose an admin page at `/admin/config-v2` that presents configuration
as a tree: **Tool → Generation model → Mode → Cost variant**, merged from code registries
(`VIDEO_MODELS`, `PRODUCT_PHOTO_TIERS`, `MOTION_CONTROL_MODELS`) and database rows
(`tool_configs`, `pricing_configs`, `feature_model_configs`, `model_configs`).

Each tool section SHALL support toggling **enabled** and **visible_in_sidebar** with
persistence to `tool_configs`.

Each cost variant SHALL display **Credits** (authoritative user charge) and **Replicate
$** (provider reference), with a **Suggest** action that recalculates credits from
provider USD using current `billing_settings`.

#### Scenario: Admin views Video tool tree

- **WHEN** an admin opens `/admin/config-v2` and expands the Video tool
- **THEN** generation models from `VIDEO_MODELS` and motion control models appear with
  their eligible modes and pricing variants

#### Scenario: Admin saves variant credits

- **WHEN** an admin edits Credits on a variant and clicks Save
- **THEN** `pricing_configs.credit_amount` is updated for that `pricing_key` and runtime
  pricing reflects the change within the resolver cache TTL (~60s)

### Requirement: Exclusive default per mode

For each mode (feature/composer key) within a tool, exactly one enabled model SHALL be
marked default across all models. The tree builder SHALL normalize duplicate defaults on
load. The UI SHALL prompt for confirmation when overriding an existing default.

#### Scenario: Duplicate defaults normalized on load

- **WHEN** multiple models would claim default for the same mode during tree build
- **THEN** only the first model in registry order retains `isDefault: true`

#### Scenario: Admin overrides default

- **WHEN** an admin checks Default on model B while model A is already default for that mode
- **THEN** a confirmation dialog appears and on confirm model B becomes the sole default

### Requirement: Photo mode matrix persistence

Photo generation models SHALL expose modes `image`, `product`, and `character` when
eligible. Enablement and default flags SHALL persist to `feature_model_configs` via
`PATCH /api/admin/config/feature-models/:id`. Save modes SHALL batch all rows for the
Photo tool.

Ineligible modes (e.g. product try-on on text-only tiers) SHALL NOT appear in the UI.

#### Scenario: Photo mode save persists

- **WHEN** an admin toggles a Photo mode and clicks Save modes
- **THEN** the corresponding `feature_model_configs` rows update and Photo studio reads
  the new enablement via `/api/tools/photo/features`

### Requirement: Pipeline roles per composer

Video and Photo tools SHALL include a collapsible **Pipeline** section grouping fixed
internal roles by composer, as defined in `lib/admin-pipeline-config.ts`:

- Video: Reels Creator (`reels.*`), Reels Creator Veo engine (`veo.*`), Storyboard to
  video (descriptive; lists models with storyboard composer)
- Photo: Storyboard sheet (`storyboard.scene_llm`, `storyboard.image`) with storyboard
  pricing variants

Pipeline roles SHALL display current provider and model identifiers (read-only until
schema editor ships). Enabled toggles SHALL persist to `model_configs` when a DB row
exists.

#### Scenario: Pipeline displays storyboard sheet roles

- **WHEN** an admin expands Photo → Pipeline → Storyboard sheet
- **THEN** Scene LLM and Storyboard image roles appear with provider/model text and
  editable storyboard pricing variants

### Requirement: Storyboard hybrid placement

Storyboard **sheet** generation (Photo studio Storyboard mode) SHALL be configured under
Photo tool Pipeline, not as a fourth Photo feature matrix row. Storyboard **video**
generation SHALL use Video generation models with the `storyboard` composer mode; the
Pipeline group SHALL document this and list eligible models.

#### Scenario: Storyboard video uses generation catalog

- **WHEN** an admin configures Storyboard to video
- **THEN** they set default/enabled on Video models' storyboard mode, not a fixed
  `storyboard.video` pipeline role as the user-facing picker

### Requirement: Pricing fallback for catalog keys

When a generation model's pricing key has no `pricing_configs` row, the tree builder
SHALL fall back to `lib/pricing-defaults.ts` so the model is not hidden from the admin
tree. This SHALL match the runtime resolver fallback chain.

#### Scenario: Extended photo model visible without DB pricing row

- **WHEN** `product_photo_seedream_4_per_image` has no DB row
- **THEN** Seedream 4 still appears in the Photo tool with credits derived from the
  built-in default

### Requirement: Video composer persistence (planned — Phase 2)

Video composer enablement and defaults SHALL persist to `feature_model_configs` with
`tool_key = 'reels'` and `feature_key` matching composer keys (`text2video`, `image2video`,
`motion_control`, `storyboard`, `reels-creator`). Video studio SHALL read enablement via
a dedicated features API mirroring Photo.

#### Scenario: Video composer toggle survives refresh

- **WHEN** an admin disables a mode for a video model and saves
- **THEN** after page refresh the toggle remains off and Video studio omits that model
  for that composer

### Requirement: Legacy cutover (planned — Phase 1)

After parity verification, `/admin/config` SHALL redirect to or be replaced by the v2
page. The legacy three-tab implementation SHALL be removed from the active codebase.

#### Scenario: Single config entry point

- **WHEN** an admin navigates to Config from the admin nav
- **THEN** they land on the unified tree panel without a separate "Config v2" label
