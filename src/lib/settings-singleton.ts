/**
 * RestaurantSettings singleton configuration.
 *
 * The settings table has exactly one row, identified by this deterministic ID.
 * This avoids findFirst() ambiguity and prevents multiple settings rows.
 */

export const SETTINGS_SINGLETON_ID = 'main'
