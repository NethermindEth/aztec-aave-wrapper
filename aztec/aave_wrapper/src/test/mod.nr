/// Test module for AaveWrapper contract.
///
/// This module provides comprehensive test coverage for all L2 contract functions.
/// Tests are organized into logical categories:
///
/// - `deposit_tests` - Tests for deposit flow (intent creation, message content hashing)
/// - `withdraw_tests` - Tests for withdraw flow (intent creation, message content hashing)
/// - `refund_tests` - Tests for refund flow (deadline expiry, note regeneration)
/// - `cancel_deposit_tests` - Tests for cancel_deposit flow (timeout refunds for deposits)
/// - `edge_cases` - Tests for boundary conditions, error scenarios, and security properties
///
/// Note: Integration tests for stateful contract behavior (authorization, replay protection,
/// balance validation) are implemented in TypeScript using aztec.js in the e2e test suite.
/// See: /e2e/src/integration.test.ts

mod deposit_tests;
mod withdraw_tests;
mod refund_tests;
mod cancel_deposit_tests;
mod edge_cases;
