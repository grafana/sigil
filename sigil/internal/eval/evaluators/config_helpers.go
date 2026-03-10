package evaluators

func configBool(config map[string]any, key string, defaultValue bool) bool {
	if config == nil {
		return defaultValue
	}
	value, ok := config[key]
	if !ok {
		return defaultValue
	}
	asBool, ok := value.(bool)
	if !ok {
		return defaultValue
	}
	return asBool
}

func configInt(config map[string]any, key string) (int, bool) {
	if config == nil {
		return 0, false
	}
	raw, ok := config[key]
	if !ok {
		return 0, false
	}
	switch typed := raw.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}
