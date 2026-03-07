"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const telegram_read_service_1 = require("./src/services/share-v2/telegram-read.service");
const telegram_service_1 = require("./src/services/telegram.service");
const db_1 = __importDefault(require("./src/config/db"));
function test() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d;
        try {
            const res = yield db_1.default.query('SELECT owner_user_id FROM share_links_v2 WHERE id = $1', ['ff43ac12-492f-4729-8b4d-48be5586ddaf']);
            const ownerId = (_d = res.rows[0]) === null || _d === void 0 ? void 0 : _d.owner_user_id;
            const resolved = yield (0, telegram_read_service_1.resolveTelegramMessageForShareItem)(ownerId, 'me', 34775);
            if ('failure' in resolved) {
                console.error("FAILURE:", resolved.failure);
            }
            else {
                console.log("SUCCESS, testing iterFileDownload...");
                let bytes = 0;
                const iter = (0, telegram_service_1.iterFileDownload)(resolved.client, resolved.message, 0, Infinity);
                try {
                    for (var _e = true, iter_1 = __asyncValues(iter), iter_1_1; iter_1_1 = yield iter_1.next(), _a = iter_1_1.done, !_a; _e = true) {
                        _c = iter_1_1.value;
                        _e = false;
                        const chunk = _c;
                        bytes += chunk.length;
                        console.log(`Downloaded ${chunk.length} bytes (Total: ${bytes})`);
                        break; // Just one chunk is enough to test if iterDownload works
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (!_e && !_a && (_b = iter_1.return)) yield _b.call(iter_1);
                    }
                    finally { if (e_1) throw e_1.error; }
                }
                console.log(`Finished, got ${bytes} bytes`);
            }
        }
        catch (e) {
            console.error("UNKNOWN ERROR:", e.message);
        }
        finally {
            yield db_1.default.end();
            process.exit(0);
        }
    });
}
test();
