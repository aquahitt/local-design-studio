import type {
  LibraryMetadata,
  Props,
  FieldSchema,
  ComponentMetadata,
} from "./sdk";
const options = [
  { value: "all", code: "all", label: "Все" },
  { value: "active", code: "active", label: "Активные" },
];
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="600" height="360" fill="#dde6eb"/><path d="M100 300V100h120v200M260 300V60h180v240" fill="#77939f"/><text x="24" y="340" font-size="18">Synthetic fixture</text></svg>',
  );
export const localDefaults: Record<string, Props> = {
  Button: {
    children: "Продолжить",
    variant: "primary",
    size: "md",
    disabled: false,
  },
  IconButton: {
    children: "+",
    "aria-label": "Добавить",
    variant: "glass",
    size: "md",
  },
  BackButton: { "aria-label": "Назад" },
  CloseButton: { "aria-label": "Закрыть" },
  Card: { children: "Карточка с синтетическими данными", className: "p-5" },
  Text: { children: "Текст интерфейса", variant: "body", tone: "primary" },
  Badge: { children: "Новый", tone: "accent" },
  Chip: { children: "Квартиры", selected: true },
  Checkbox: { checked: true, label: "С уведомлениями", disabled: false },
  Skeleton: { variant: "block" },
  SkeletonText: { lines: 3 },
  ChipScroller: { children: "Квартиры · Дома · Коммерческие помещения" },
  SegmentedControl: { options, value: "all", ariaLabel: "Период" },
  ChipRadioRow: { options, value: "all", ariaLabel: "Категория" },
  RadioChips: { options, value: "all", disabled: false },
  FeatureCheckboxes: { options, value: ["all"], disabled: false },
  TagAutocomplete: {
    value: "ремонт, ",
    suggestions: ["ремонт", "отделка", "дизайн"],
    removeTagLabel: "Удалить",
    multi: true,
    chips: true,
    placeholder: "Добавить тег",
    disabled: false,
  },
  ListRow: {
    label: "Уведомления",
    hint: "Изменения объектов",
    value: "Включены",
    chevron: true,
  },
  MetricCard: {
    label: "Просмотры",
    value: "1 240",
    delta: "+12%",
    trend: "up",
  },
  ScreenHeader: { title: "Каталог", backLabel: "Назад" },
  Money: { amount: "245 000", currency: "BYN", prefix: "от" },
  CurrencySymbol: { currency: "BYN" },
  ApproxBynLine: { amount: "245 000", prefix: "≈" },
  StarRating: { avg: 4.8, count: 24, emptyLabel: "Нет отзывов" },
  Avatar: { name: "Ирина Соколова", size: "md" },
  AnonymousAvatar: { size: "md" },
  ServiceLogo: { name: "Мастерская", websites: [] },
  DevLogo: { name: "Проект", website: "", fallback: "П" },
  SocialIcon: { platform: "telegram", url: "#fixture" },
  ResultState: { tone: "success", message: "Сохранено" },
  ConfirmDialog: {
    title: "Подтвердить действие",
    description: "Синтетический пример подтверждения.",
    confirmLabel: "Подтвердить",
    cancelLabel: "Отмена",
    busy: false,
    error: null,
  },
  AttributeFields: {
    attributes: [
      {
        code: "finish",
        label: "Отделка",
        multi: true,
        values: [
          { code: "finished", label: "Чистовая" },
          { code: "shell", label: "Черновая" },
        ],
      },
    ],
    value: {},
    disabled: false,
  },
  CategoryFilter: {
    categories: [
      { slug: "renovation", label: "Ремонт", parent_slug: null },
      { slug: "design", label: "Дизайн", parent_slug: null },
    ],
    value: "",
    labels: { all: "Все категории", back: "Назад" },
    variant: "default",
  },
  ImageCarousel: {
    images: [{ image_url: image, thumb_url: image }],
    label: "Галерея",
    labels: {
      close: "Закрыть",
      previous: "Предыдущее",
      next: "Следующее",
      image: "Изображение",
    },
    className: "h-56",
  },
  BuildingGallery: {
    images: [{ image_url: image, thumb_url: image, section: "photos" }],
    isLoading: false,
    labels: {
      sections: { photos: "Фото", layouts: "Планировки" },
      loading: "Загрузка",
      viewer: {
        viewer: "Просмотр",
        close: "Закрыть",
        prev: "Предыдущее",
        next: "Следующее",
      },
    },
  },
  BuildingPriceTables: {
    tables: [
      {
        object_type: "apartment",
        kind: "list",
        headers: ["Комнаты", "Площадь", "Стоимость"],
        currency: "BYN",
        vat_included: true,
        rows: [
          {
            cells: ["1", "42", "245000"],
            area: "42",
            price_per_sqm: "5833",
            total_price: "245000",
            total_is_estimate: false,
          },
        ],
      },
    ],
    defaultOpen: true,
    collapsible: false,
    isLoading: false,
    labels: {
      title: "Цены",
      loading: "Загрузка",
      types: { apartment: "Квартиры" },
      sortTitle: "Сортировка",
      sorts: {
        source: "Исходная",
        area: "Площадь",
        price_per_sqm: "За м²",
        total_price: "Стоимость",
      },
      priceWithVat: "Цена с НДС",
      priceWithoutVat: "Цена без НДС",
      estimatedTotal: "Расчётная стоимость",
      footnote: "Синтетические данные",
    },
  },
  ServiceCard: {
    service: {
      id: "synthetic-service",
      slug: "sample",
      name: "Мастерская интерьеров",
      description: "Отделка и ремонт квартир",
      categories: ["renovation"],
      locations: [],
      contacts: {},
      price_min: 120,
      price_currency: "BYN",
      rating_avg: 4.8,
      review_count: 24,
    },
    categoryLabels: { renovation: "Ремонт" },
    labels: {
      verified: "Проверен",
      noReviews: "Нет отзывов",
      from: "от",
      negotiable: "Договорная",
      online: "Онлайн",
    },
    responseSpeedLabel: "Отвечает за 2 часа",
  },
  ServicePriceValue: {
    parts: { amount: "120", currency: "BYN", unitLabel: "за м²" },
  },
  FxExplainer: {
    labels: { priceLabel: "Цена проекта", areaUnit: "м²" },
    source: { price: "100 000", currency: "USD" },
    rateLine: "1 USD = 3,20 BYN",
    approxAmount: "320 000",
    disclaimer: "Синтетический курс для примера.",
  },
  ObjectHistoryTimeline: {
    entries: [
      {
        id: "sample",
        event_type: "price_changed",
        occurred_at: "2026-01-15T10:00:00Z",
        changes: [{ field: "price", old: 245000, new: 240000 }],
      },
    ],
    currency: "BYN",
    labels: { empty: "Нет изменений", title: "История" },
  },
  Tabs: {
    value: "overview",
    variant: "underline",
    size: "md",
    activationMode: "automatic",
    className: "",
    triggerClassName: "",
    tabs: [
      { value: "overview", label: "Обзор", content: "Обзор проекта" },
      { value: "details", label: "Детали", content: "Синтетические детали" },
    ],
  },
  SheetHeader: {
    title: "Детали",
    titleMode: "inline",
    dismiss: "close",
    dismissLabel: "Закрыть",
  },
  SheetScrollHead: { children: "Содержимое раздела" },
  Modal: { ariaLabel: "Пример диалога", children: "Содержимое диалога" },
  Sheet: {
    title: "Детали",
    dismissLabel: "Закрыть",
    children: "Содержимое листа",
  },
  GameModal: {
    title: "Игра",
    closeLabel: "Закрыть",
    children: "Содержимое игры",
  },
  FullscreenLayer: { ariaLabel: "Полный экран", children: "Содержимое экрана" },
  Markdown: {
    children:
      "**Заголовок**\n\nСинтетическое описание.\n\n- Первый пункт\n- Второй пункт",
  },
  MarkdownEditor: {
    value: "Описание проекта",
    labels: {
      bold: "Жирный",
      italic: "Курсив",
      list: "Список",
      link: "Ссылка",
      preview: "Предпросмотр",
      edit: "Изменить",
      emptyPreview: "Пусто",
    },
  },
  OverflowActions: { labels: { more: "Ещё", menu: "Действия" } },
  TabsList: {},
  TabsTrigger: {},
  TabsContent: {},
};
// These primitives need Tabs context, so the catalog previews their composition.
for (const name of ["TabsList", "TabsTrigger", "TabsContent"])
  localDefaults[name] = localDefaults.Tabs;
localDefaults.ImageLightbox = { ...localDefaults.ImageCarousel, index: 0 };
for (const name of [
  "AnagramGame",
  "QuizGame",
  "MemoryGame",
  "NailGame",
  "SlidePuzzle",
  "WordcraftGame",
  "TowerGame",
  "PipeGame",
  "TileGame",
  "WallpaperGame",
  "FurnitureGame",
  "WarehouseGame",
  "PaintGame",
  "WireGame",
  "RenovationGame",
])
  localDefaults[name] = {};
export function createLocalMetadata(input: {
  version: string;
  exports: LibraryMetadata["exports"];
  fields: Record<string, Record<string, FieldSchema>>;
  tokens: LibraryMetadata["tokens"];
}): LibraryMetadata {
  const components: Record<string, ComponentMetadata> = {};
  for (const item of input.exports ?? []) {
    if (item.kind !== "component") continue;
    const defaults = localDefaults[item.name];
    const composedTabs = /^Tabs(?:List|Trigger|Content)?$/.test(item.name);
    const fields: Record<string, FieldSchema> = composedTabs
      ? {
          value: { type: "string" },
          variant: { type: "select", options: ["underline", "pill"] },
          size: { type: "select", options: ["sm", "md"] },
          activationMode: { type: "select", options: ["automatic", "manual"] },
          className: { type: "string" },
          triggerClassName: { type: "string" },
          tabs: { type: "json" },
        }
      : { ...input.fields[item.name] };
    for (const [key, value] of Object.entries(defaults ?? {}))
      if (!fields[key])
        fields[key] = {
          type:
            typeof value === "boolean"
              ? "boolean"
              : typeof value === "number"
                ? "number"
                : typeof value === "string"
                  ? "string"
                  : "json",
        };
    const fixtures = [{ name: "Default", props: {} as Props }];
    const states = ["default"];
    if (composedTabs)
      fixtures.push(
        { name: "Small pills", props: { variant: "pill", size: "sm" } },
        { name: "Medium pills", props: { variant: "pill", size: "md" } },
        {
          name: "Custom tabs",
          props: {
            value: "prices",
            triggerClassName: "px-4 py-2",
            tabs: [
              { value: "photos", label: "Фото", content: "Галерея проекта" },
              { value: "prices", label: "Цены", content: "От 120 000 BYN" },
            ],
          },
        },
      );
    if (fields.disabled) {
      fixtures.push({ name: "Disabled", props: { disabled: true } });
      states.push("disabled");
    }
    if (fields.busy || fields.isLoading) {
      fixtures.push({
        name: "Loading",
        props: { [fields.busy ? "busy" : "isLoading"]: true },
      });
      states.push("loading");
    }
    if (fields.error) {
      fixtures.push({
        name: "Error",
        props: { error: "Не удалось сохранить" },
      });
      states.push("error");
    }
    const textKey = ["children", "label", "title", "message"].find(
      (key) => typeof defaults?.[key] === "string",
    );
    if (textKey) {
      fixtures.push({
        name: "Long text",
        props: {
          [textKey]:
            "Длинный синтетический текст для проверки переноса и поведения в узком контейнере",
        },
      });
      states.push("long-text");
    }
    const variantKey = ["variant", "tone"].find(
      (key) => fields[key]?.options?.length,
    );
    if (variantKey)
      for (const value of fields[variantKey].options!)
        fixtures.push({ name: value, props: { [variantKey]: value } });
    components[item.name] = {
      name: item.name,
      category: /Game|Challenge/.test(item.name)
        ? "Games"
        : /Modal|Sheet|Layer/.test(item.name)
          ? "Overlays"
          : "Components",
      fields,
      defaultProps: defaults ?? {},
      fixtures,
      states,
      variants: variantKey ? fields[variantKey].options : [],
      support: defaults ? "rendered" : "requires-context",
      description: defaults
        ? "Real local component; synthetic fixture, no network data."
        : "Export requires an application-specific provider or composed context. See the local source API.",
    };
  }
  return {
    sdkVersion: 1,
    capabilities: { jsonProps: true, tokenRefs: true, slots: true },
    id: "stroi-ui",
    version: input.version,
    name: "Local project UI",
    components,
    exports: input.exports,
    tokens: input.tokens,
    themes: [
      {
        id: "pwa-light",
        name: "PWA light",
        attributes: { "data-studio-theme": "pwa-light" },
      },
      {
        id: "pwa-dark",
        name: "PWA dark",
        className: "dark",
        attributes: { "data-studio-theme": "pwa-dark" },
      },
      {
        id: "web-light",
        name: "Web light",
        attributes: { "data-studio-theme": "web-light" },
      },
      {
        id: "web-dark",
        name: "Web dark",
        className: "dark",
        attributes: { "data-studio-theme": "web-dark" },
      },
    ],
  };
}
