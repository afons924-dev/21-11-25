const events = {};

/**
 * Subscribes to an event.
 * @param {string} eventName - The name of the event to subscribe to.
 * @param {Function} fn - The callback function to execute.
 */
export function on(eventName, fn) {
    events[eventName] = events[eventName] || [];
    events[eventName].push(fn);
}

/**
 * Unsubscribes from an event.
 * @param {string} eventName - The name of the event to unsubscribe from.
 * @param {Function} fn - The callback function to remove.
 */
export function off(eventName, fn) {
    if (events[eventName]) {
        for (var i = 0; i < events[eventName].length; i++) {
            if (events[eventName][i] === fn) {
                events[eventName].splice(i, 1);
                break;
            }
        };
    }
}

/**
 * Emits an event, calling all subscribed functions.
 * @param {string} eventName - The name of the event to emit.
 * @param {*} data - The data to pass to the callback functions.
 */
export function emit(eventName, data) {
    if (events[eventName]) {
        events[eventName].forEach(function(fn) {
            fn(data);
        });
    }
}
