const FORWARD_TRANSITIONS = {
  new: ['confirmed'],
  confirmed: ['preparing'],
  preparing: ['shipped'],
  shipped: ['delivered']
};

// Cancellation is only allowed before the order has shipped.
const CANCELLABLE_FROM = ['new', 'confirmed', 'preparing'];

function canTransition(from, to) {
  return Array.isArray(FORWARD_TRANSITIONS[from]) && FORWARD_TRANSITIONS[from].includes(to);
}

function canCancel(from) {
  return CANCELLABLE_FROM.includes(from);
}

module.exports = { FORWARD_TRANSITIONS, canTransition, canCancel };
