/**
 * 判断所给值是否是函数
 * @param fn
 * @returns {boolean}
 */
exports.isFn = fn => typeof fn === "function";

/**
 * 判断传入值是否为对象
 * @param obj
 * @returns {boolean}
 */
exports.isObj = obj => typeof obj === "object";

/**
 * 警告提示
 * @param message
 */
exports.warn = message => console.warn(`%cKPromise运行警告：`,"color: #FFFFFF; font-weight; bold; padding: 3px 5px; background: brown; border-radius: 3px; border: 1px dashed #FFF;",message);

/**
 * 一个没有任何逻辑的函数，传进来是什么，就返回什么
 * @param _
 * @returns {*}
 */
exports.identity = _ => _;

/**
 * 将多个函数和变为管道函数，前一个函数的执行结果作为后一个函数的参数传入
 * @param fns
 * @returns {function(*=): (*)}
 */
exports.wrapperFn = (...fns) => fn => fns.reduce((prevFn, nextFn) => nextFn(prevFn), fn);