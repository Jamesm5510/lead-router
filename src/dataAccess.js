/**
 * dataAccess.js
 *
 * All reads and writes to advisors.json go through here.
 * Keeping data access separate means you can swap to a DB later
 * by only changing this file — routing logic stays untouched.
 */

const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/advisors.json');

/** Read all advisors from disk. Always fresh — no in-memory caching. */
function readAdvisors() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

/** Overwrite advisors.json with the provided array. */
function writeAdvisors(advisors) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(advisors, null, 2), 'utf-8');
}

/** Find a single advisor by their id field. Returns null if not found. */
function getAdvisorById(id) {
  return readAdvisors().find(a => a.id === id) || null;
}

/**
 * Create a new advisor. Auto-generates an id from the name.
 * New advisors are never set as isDefault.
 */
function createAdvisor(data) {
  const advisors = readAdvisors();

  // Build a url-safe id from the name, with a collision suffix if needed
  const baseId = data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  let id = baseId;
  let n = 1;
  while (advisors.find(a => a.id === id)) {
    id = `${baseId}-${n++}`;
  }

  const newAdvisor = {
    id,
    name: data.name,
    isDefault: false,
    licensedStates: data.licensedStates || [],
    targetAppointmentsPerMonth: Number(data.targetAppointmentsPerMonth) || 10,
    appointmentsDeliveredThisMonth: 0,
    appointmentsDeliveredThisWeek: 0,
    calendarUrl: data.calendarUrl || '',
    isActive: data.isActive !== false,
    manualPriorityBoost: Number(data.manualPriorityBoost) || 0,
    notes: data.notes || '',
  };

  advisors.push(newAdvisor);
  writeAdvisors(advisors);
  return newAdvisor;
}

/**
 * Merge `updates` into the advisor with the given id and persist to disk.
 * Returns the updated advisor object, or null if the id wasn't found.
 */
function updateAdvisor(id, updates) {
  const advisors = readAdvisors();
  const idx = advisors.findIndex(a => a.id === id);
  if (idx === -1) return null;

  advisors[idx] = { ...advisors[idx], ...updates };
  writeAdvisors(advisors);
  return advisors[idx];
}

/**
 * Delete an advisor by id. Returns true if deleted, false if not found.
 * The default advisor cannot be deleted — enforce this at the route level.
 */
function deleteAdvisor(id) {
  const advisors = readAdvisors();
  const idx = advisors.findIndex(a => a.id === id);
  if (idx === -1) return false;

  advisors.splice(idx, 1);
  writeAdvisors(advisors);
  return true;
}

module.exports = { readAdvisors, writeAdvisors, getAdvisorById, createAdvisor, updateAdvisor, deleteAdvisor };
