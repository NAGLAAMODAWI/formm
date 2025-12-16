const apiURL = "https://development.vr-twins.com/api/units";
let originalUnits = []; // ضعيه هنا في أول الملف الحالة الاصلية للوحدات


// 🔁 دالة لجلب وتحديث الوحدات

async function updateHotspots() {
  try {
    const response = await fetch(apiURL);
    if (!response.ok) throw new Error(`فشل تحميل البيانات من API: ${response.status}`);

    const json = await response.json();

    const fetchedUnits = (json.data?.data || []).map(item => ({
      id: item.id.toString(),
      status: item.available == 1 ? "available" : "sold",
      raw: item
    }));

    // أول مرة فقط نخزن الأصل
    if (originalUnits.length === 0) {
      originalUnits = fetchedUnits.map(u => ({ id: u.id, status: u.status }));
    }

    // التحديث الدائم للنسخة المخزنة حتى لو في فلترة
    // لكن لا نلمس الشاشة
    if (isAnyFilterActive()) {
      // نحدث الحالة "الأصلية" من غير ما نعدل الهوتسبوتات
      originalUnits = fetchedUnits.map(u => ({ id: u.id, status: u.status }));
      window._latestUnits = fetchedUnits;

      // console.log("🔄 تم تحديث الوحدات في الخلفية (العميل في وضع فلترة).");
      return;
    }

    // لو ما في فلترة -> يحدث الهوتسبوتات على الشاشة
    const allHotspots = window.blazeIT.getAllHotspots();

    allHotspots.forEach(hotspot => {
      const unitId = hotspot.get("data").label?.toString();
      if (!unitId) return;

      const unitInfo = fetchedUnits.find(u => u.id === unitId);
      if (!unitInfo) return;

      const isSold = unitInfo.status === "sold";

      const redHotspotId = `${unitId}_red`;
      const redHotspot = allHotspots.find(h => h.get("data").label?.toString() === redHotspotId);

      if (isSold) {
        hotspot.set("enabled", false);
        if (redHotspot) redHotspot.set("enabled", true);
      } else {
        hotspot.set("enabled", true);
        if (redHotspot) redHotspot.set("enabled", false);
      }
    });

    // تحديث النسخة الأخيرة
    window._latestUnits = fetchedUnits;

  } catch (err) {
    console.error("❌ خطأ أثناء التحديث:", err);
  }
}



// ⏳ الانتظار حتى يكون blazeIT جاهز، ثم بدء التحديث
const waitForBlazeIT = setInterval(() => {
  if (window.blazeIT && typeof window.blazeIT.getAllHotspots === "function") {
    clearInterval(waitForBlazeIT);
    /*console.log("✅ blazeIT جاهز، بدء تحديث الوحدات...");*/
    updateHotspots(); // أول تحديث عند التشغيل

    // ⏰ تحديث كل دقيقة
    setInterval(updateHotspots, 60000); // 3600000 مللي ثانية = 1 ساعة
  }
}, 500);


// دالة عامة للفلترة حسب شرط معين من API
// 🧩 حالة الفلترة النشطة
// 🔹 تحديث activeFilters لدعم array لكل فلتر
let activeFilters = {
  bedrooms: [],         //يمكن اختيار اكثر من عدد غرف
  bathrooms: [],
  type: [],
  priceRanges: [], // متعدّد
  areaRanges: []   // متعدّد
};


// دالة toggle متعددة القيم داخل فلتر واحد
function toggleMulti(key, value) {
  const arr = activeFilters[key];
  const index = arr.indexOf(value);

  if (index > -1) {
    arr.splice(index, 1); // إزالة
  } else {
    arr.push(value); // إضافة
  }
}


// دالة toggle range كما قبل
function toggleRangeMulti(key, minVal, maxVal) {
  const ranges = activeFilters[key];

  const index = ranges.findIndex(r => r.min === minVal && r.max === maxVal);
  if (index > -1) {
    ranges.splice(index, 1); // إزالة الرينج
  } else {
    ranges.push({ min: minVal, max: maxVal }); // إضافة رينج جديد
  }
}


// الدالة الرئيسية للفلترة
window.filterUnits = async function(options = {}) {
  try {
    // ------------ تحديث الفلاتر حسب نوع الزر ------------

    if (options.bedrooms !== undefined) {
      toggleMulti("bedrooms", options.bedrooms);
    }

    if (options.bathrooms !== undefined) {
      toggleMulti("bathrooms", options.bathrooms);
    }

    if (options.type !== undefined) {
      toggleMulti("type", options.type);
    }

    if (options.minPrice !== undefined && options.maxPrice !== undefined) {
      toggleRangeMulti("priceRanges", options.minPrice, options.maxPrice);
    }

    if (options.minArea !== undefined && options.maxArea !== undefined) {
      toggleRangeMulti("areaRanges", options.minArea, options.maxArea);
    }

    // ------------ هل في أي فلتر شغال؟ ------------
    const hasFilter =
      activeFilters.bedrooms.length ||
      activeFilters.bathrooms.length ||
      activeFilters.type.length ||
      activeFilters.priceRanges.length ||
      activeFilters.areaRanges.length;

    if (!hasFilter) {
      resetFilter();
      return;
    }

    // ------------ جلب البيانات من API ------------
    const response = await fetch(apiURL);
    const result = await response.json();
    const allUnits = result.data?.data || [];

    // ------------ الفلترة ------------
    const filtered = allUnits.filter(u => {
      // نوع الوحدة
      if (activeFilters.type.length &&
          !activeFilters.type.includes(u.type)) return false;

      // الغرف
      if (activeFilters.bedrooms.length &&
          !activeFilters.bedrooms.includes(u.bedrooms_count)) return false;

      // الحمامات
      if (activeFilters.bathrooms.length &&
          !activeFilters.bathrooms.includes(u.bathrooms_count)) return false;

      // رينجات المساحة (OR)
      if (activeFilters.areaRanges.length) {
        const inside = activeFilters.areaRanges.some(r =>
          u.surface >= r.min && u.surface <= r.max
        );
        if (!inside) return false;
      }

      // رينجات السعر (OR)
      if (activeFilters.priceRanges.length) {
        const inside = activeFilters.priceRanges.some(r =>
          u.price >= r.min && u.price <= r.max
        );
        if (!inside) return false;
      }

      return true;
    });

    // ------------ إذا ما في نتائج ------------

    if (filtered.length === 0) {
  showNoUnitsMessageVista();
}


    // ------------ عرض النتائج على الخريطة ------------
    const allHotspots = window.blazeIT.getAllHotspots();
    allHotspots.forEach(h => h.set("enabled", false));

    filtered.forEach(unit => {
      const id = unit.id.toString();
      const redId = `${id}_red`;

      const normal = allHotspots.find(h => h.get("data").label?.toString() === id);
      const red = allHotspots.find(h => h.get("data").label?.toString() === redId);

      if (unit.available == 1) {
        if (normal) normal.set("enabled", true);
        if (red) red.set("enabled", false);
      } else {
        if (normal) normal.set("enabled", false);
        if (red) red.set("enabled", true);
      }
    });

  } catch (err) {
    console.error("Error:", err);
  }
};

// دالة لإظهار رسالة "لا توجد وحدات" لفترة قصيرة (مثلاً في فيستا)
function showNoUnitsMessageVista() {
  const comp = window.blazeIT.getComponentByName("no_units_popup");

  if (!comp) {
    console.error("Component not found: no_units_popup");
    return;
  }

  // إظهاره
  comp.set("visible", true);

  // إخفاء تلقائي بعد ثانيتين
  setTimeout(() => {
    comp.set("visible", false);
  }, 2000);
}




function isAnyFilterActive() {
  return (
    activeFilters.bedrooms.length ||
    activeFilters.bathrooms.length ||
    activeFilters.type.length ||
    activeFilters.priceRanges.length ||
    activeFilters.areaRanges.length
  );
}


// ♻️ دالة لإرجاع الحالة الأصلية (تشمل الهوتسبوت الأحمر)
window.resetFilter = function() {
  const allHotspots = window.blazeIT.getAllHotspots();

  allHotspots.forEach(hotspot => {
    const unitId = hotspot.get("data").label?.toString();
    const unitInfo = originalUnits.find(u => u.id === unitId);

    if (unitInfo) {
      const isSold = unitInfo.status === "sold";
      const redHotspotId = `${unitId}_red`;
      const redHotspot = allHotspots.find(h => h.get("data").label?.toString() === redHotspotId);

      if (isSold) {
        hotspot.set("enabled", false);
        if (redHotspot) redHotspot.set("enabled", true);
      } else {
        hotspot.set("enabled", true);
        if (redHotspot) redHotspot.set("enabled", false);
      }
    }
  });

  // console.log("♻️ تمت استعادة جميع الوحدات لحالتها الأصلية (مع الهوتسبوت الأحمر).");
}




/*Dynamic Container Loading content*/

window.showUnitDetails = async function(unitId) {
  try {
    /*console.log(`📦 Loading data for unit ID: ${unitId}`);*/

    // 1. جلب بيانات الوحدة من الـAPI
    const response = await fetch(`https://development.vr-twins.com/api/units/${unitId}`);
    const result = await response.json();

    if (!result?.data) {
      console.error("⚠️ No data found for this unit.");
      return;
    }

    const unit = result.data;

    // 2. تحديد المكونات داخل container
    const unitnumber = window.blazeIT.getComponentByName("unit_number");
    const bedroomComp = window.blazeIT.getComponentByName("bedroom");
    const bathroomComp = window.blazeIT.getComponentByName("bathroom");
    const areaComp = window.blazeIT.getComponentByName("area");
    const priceComp = window.blazeIT.getComponentByName("price");

    // 3. تحديث القيم داخل المكونات
    //if (unitnumber) unitnumber.set("text",  (unit.unit_no ?? "--"));
   
// تخزين رقم الوحدة في localStorage لاستخدامه في الفورم
if (unitnumber) {
  const value = unit.unit_no.toString(); // أو unit.unit_no لو عندك
  unitnumber.set("text", value);

  //  نخزن رقم الوحدة للفورم
  localStorage.setItem("selected_unit_id", value);
}

    if (bedroomComp) bedroomComp.set("text", unit.bedrooms_count ?? "--");
    if (bathroomComp) bathroomComp.set("text", unit.bathrooms_count ?? "--");
    if (areaComp) areaComp.set("text", unit.surface ?? "--");
    if (priceComp) priceComp.set("text", `${unit.price ?? "--"} SAR`);

   /* console.log("✅ Unit data displayed successfully.");*/

  } catch (error) {
    console.error("❌ Error fetching unit data:", error);
  }
};
    

