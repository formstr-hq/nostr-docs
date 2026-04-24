export const KIND_POLL = 1068;
export const KIND_POLL_RESPONSE = 1018;
export const KIND_POLL_RESPONSE_ALT = 1070;

export const POLL_RESPONSE_KINDS = [
  KIND_POLL_RESPONSE,
  KIND_POLL_RESPONSE_ALT,
] as const;

export const POLL_OPTION_TAG = "option";
export const POLL_TYPE_TAG = "polltype";
export const POLL_EXPIRY_TAG = "endsAt";
export const POLL_RELAY_TAG = "relay";
export const POLL_LABEL_TAG = "label";

export const POLL_TYPE_SINGLE = "singlechoice";
export const POLL_TYPE_MULTI = "multiplechoice";
