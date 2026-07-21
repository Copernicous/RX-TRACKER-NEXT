# Staging Role Modal Blur Fix

Date: 2026-06-30

## Issue

When modifying roles on staging, the Roles screen could remain blurred/dimmed as if a modal backdrop was active while the edit modal was not reliably usable.

## Cause

`public/js/roles.js` attached new click handlers every time the roles table refreshed, and template handlers every time the role modal opened. After saving/reloading roles, later edit clicks could fire duplicate modal opens and leave extra Bootstrap backdrops active.

## Staging Change

- Replaced stacked `addEventListener` usage with single assigned handlers for the roles table and template buttons.
- Reused Bootstrap modal instances with `getOrCreateInstance`.
- Added a small cleanup routine for orphaned modal backdrops after role/delete modals close.

## Backup

Pre-change backup:

`backups/pre-change/role-modal-blur-fix-20260630-112514.zip`

## Validation

Run staging browser smoke against `/roles`:

- Open role editor.
- Save role.
- Reopen role editor.
- Confirm one visible modal and one `.modal-backdrop`.
- Confirm no console/page errors.
