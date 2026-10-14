"""Stable category and goal presentation defaults."""


DEFAULT_CATEGORIES = [
    ("居住", "expense", "🏡", "#214f3b", 1),
    ("餐饮", "expense", "🍜", "#2f6049", 2),
    ("服饰", "expense", "👕", "#c8914b", 3),
    ("交通", "expense", "🚇", "#78a88a", 4),
    ("娱乐", "expense", "🎬", "#b46b4d", 5),
    ("医疗健康", "expense", "💊", "#6e8f7a", 6),
    ("日用百货", "expense", "🧴", "#d39b64", 7),
    ("通讯网络", "expense", "📱", "#5d8270", 8),
    ("教育学习", "expense", "📚", "#9f7a45", 9),
    ("人情礼物", "expense", "🎁", "#bd7b62", 10),
    ("旅行出游", "expense", "✈️", "#4f7f8d", 11),
    ("运动健身", "expense", "🏃", "#7da36f", 12),
    ("宠物", "expense", "🐾", "#b99a72", 13),
    ("家庭育儿", "expense", "🧸", "#d08c78", 14),
    ("美容护理", "expense", "✨", "#b86f8a", 15),
    ("保险税费", "expense", "🛡️", "#667a62", 16),
    ("物业水电", "expense", "💡", "#c0a15f", 17),
    ("车险油费", "expense", "⛽", "#a96b4f", 18),
    ("数码家电", "expense", "💻", "#5f778c", 19),
    ("公益捐赠", "expense", "🤝", "#8a9b68", 20),
    ("其他支出", "expense", "🧾", "#827f77", 21),
    ("工资", "income", "💼", "#214f3b", 1),
    ("奖金", "income", "🏆", "#c8914b", 2),
    ("投资收益", "income", "📈", "#2f6049", 3),
    ("副业收入", "income", "🧩", "#6e8f7a", 4),
    ("报销退款", "income", "↩️", "#78a88a", 5),
    ("租金收入", "income", "🔑", "#9f7a45", 6),
    ("红包礼金", "income", "🧧", "#b46b4d", 7),
    ("其他收入", "income", "💰", "#827f77", 8),
]


def get_category_visual(name, category_type="expense"):
    category_name = name or ""
    for default_name, default_type, icon, color, _ in DEFAULT_CATEGORIES:
        if category_name == default_name and category_type == default_type:
            return icon, color
    keyword_visuals = [
        ("餐", "🍜", "#2f6049"),
        ("饭", "🍜", "#2f6049"),
        ("咖啡", "☕", "#8a6b4a"),
        ("房", "🏡", "#214f3b"),
        ("租", "🏡", "#214f3b"),
        ("购", "🛍️", "#c8914b"),
        ("买", "🛍️", "#c8914b"),
        ("车", "🚗", "#a96b4f"),
        ("油", "⛽", "#a96b4f"),
        ("交通", "🚇", "#78a88a"),
        ("医", "💊", "#6e8f7a"),
        ("药", "💊", "#6e8f7a"),
        ("学", "📚", "#9f7a45"),
        ("课", "📚", "#9f7a45"),
        ("礼", "🎁", "#bd7b62"),
        ("旅行", "✈️", "#4f7f8d"),
        ("健身", "🏃", "#7da36f"),
        ("宠物", "🐾", "#b99a72"),
        ("工资", "💼", "#214f3b"),
        ("奖金", "🏆", "#c8914b"),
        ("投资", "📈", "#2f6049"),
        ("退款", "↩️", "#78a88a"),
        ("红包", "🧧", "#b46b4d"),
    ]
    for keyword, icon, color in keyword_visuals:
        if keyword in category_name:
            return icon, color
    return ("💰", "#214f3b") if category_type == "income" else ("🧾", "#827f77")


def get_goal_visual(name):
    goal_name = name or ""
    keyword_visuals = [
        ("旅行", "✈️", "#4f7f8d"),
        ("旅游", "✈️", "#4f7f8d"),
        ("车", "🚗", "#a96b4f"),
        ("房", "🏡", "#214f3b"),
        ("家", "🏡", "#214f3b"),
        ("教育", "📚", "#9f7a45"),
        ("学习", "📚", "#9f7a45"),
        ("养老", "🌿", "#667a62"),
        ("退休", "🌿", "#667a62"),
        ("应急", "🛟", "#5f778c"),
        ("备用", "🛟", "#5f778c"),
        ("婚", "💍", "#b86f8a"),
        ("医疗", "💊", "#6e8f7a"),
        ("健康", "💊", "#6e8f7a"),
        ("投资", "📈", "#2f6049"),
        ("创业", "🧩", "#6e8f7a"),
        ("礼物", "🎁", "#bd7b62"),
    ]
    for keyword, icon, color in keyword_visuals:
        if keyword in goal_name:
            return icon, color
    return "🎯", "#214f3b"
