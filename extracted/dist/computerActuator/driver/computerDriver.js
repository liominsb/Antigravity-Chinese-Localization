"use strict";
/**
 * @fileoverview Layer 3 of the computer actuator: the computer surface driver.
 * A surface (the AGY Hub's macOS helper, a future Linux or Windows one)
 * implements these finite host primitives, and the computer action layer
 * (Layer 2) drives it through them. The contract is frozen and additive-only:
 * new capabilities are new optional members or interfaces, never new required
 * members.
 *
 * Coordinates are global display points with the origin at the top-left of the
 * main display; captures report their pixel size and the display's scale.
 *
 * Confinement is part of every input call, not an optional extra: each input
 * primitive receives the {@link ConfinementPolicy} it must enforce before any
 * event reaches the OS, and a surface that can't enforce it advertises
 * `appConfinementVersion: 0`, which Layer 2 never sends input to.
 */
Object.defineProperty(exports, "__esModule", { value: true });
